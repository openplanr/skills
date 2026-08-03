import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Stage an isolated, faithful copy of the repository so a test may mutate the
// manifest or the skills tree without ever touching the working tree. The copy
// carries its own scripts/validate.mjs, so the validator resolves its root to
// the staged directory.
function stageRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-manifest-'));
  cpSync(repoRoot, dir, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(src),
  });
  return dir;
}

// Run the staged validator in isolation. OPENPLANR_ECOSYSTEM_ROOT is pinned to
// the staged dir so no external sibling checkout is consulted — the result
// depends only on the manifest and skills tree under test.
function runValidate(dir) {
  const result = spawnSync(process.execPath, [join(dir, 'scripts', 'validate.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, OPENPLANR_ECOSYSTEM_ROOT: dir },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function manifestPathOf(dir) {
  return join(dir, '.claude-plugin', 'marketplace.json');
}

test('the pinned manifest validates and ships every skill in the installed bundle', () => {
  // The exemption is only load-bearing if the planning skill genuinely carries a
  // token the portable-workflow leak check would otherwise reject.
  const planningSkill = readFileSync(join(repoRoot, 'skills', 'openplanr', 'SKILL.md'), 'utf8');
  assert.match(
    planningSkill,
    /persona role-shift/,
    'guard is vacuous unless the planning skill really carries the flagged token',
  );

  const dir = stageRepo();
  try {
    const { code, stdout, stderr } = runValidate(dir);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /10 skills validated/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the leak exemption is non-vacuous: the same token in a portable skill still fails', () => {
  const dir = stageRepo();
  try {
    const portable = join(dir, 'skills', 'planr-doctor', 'SKILL.md');
    const original = readFileSync(portable, 'utf8');

    writeFileSync(portable, `${original}\nContrast the runtimes via persona role-shift.\n`);
    const seeded = runValidate(dir);
    assert.equal(seeded.code, 1, 'a portable skill carrying the token must fail');
    assert.match(seeded.stderr, /planr-doctor contains a runtime-specific portable-workflow leak/);

    writeFileSync(portable, original);
    const restored = runValidate(dir);
    assert.equal(restored.code, 0, restored.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dropping a still-installed skill from the manifest fails with an explicit "missing"', () => {
  const dir = stageRepo();
  try {
    const path = manifestPathOf(dir);
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const declared = manifest.plugins[0].skills.slice();
    assert.ok(declared.includes('./skills/planr-doctor'));

    // Remove a declared entry WITHOUT touching the real directory — the on-disk
    // skill still ships, so the manifest's intent has diverged from the bundle.
    manifest.plugins[0].skills = declared.filter((s) => s !== './skills/planr-doctor');
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const dropped = runValidate(dir);
    assert.equal(dropped.code, 1);
    assert.match(dropped.stderr, /missing declared skill: planr-doctor/i);

    manifest.plugins[0].skills = declared;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const restored = runValidate(dir);
    assert.equal(restored.code, 0, restored.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an undeclared skill directory fails with an explicit "undeclared" (FR2)', () => {
  const dir = stageRepo();
  try {
    const straw = join(dir, 'skills', 'planr-straw');
    mkdirSync(straw, { recursive: true });
    writeFileSync(join(straw, 'SKILL.md'), '---\nname: planr-straw\n---\n\nStraw skill.\n');

    const added = runValidate(dir);
    assert.equal(added.code, 1, 'a new directory must not auto-ship without a declaration');
    assert.match(added.stderr, /undeclared skill directory would auto-ship: skills\/planr-straw/i);

    rmSync(straw, { recursive: true, force: true });
    const removed = runValidate(dir);
    assert.equal(removed.code, 0, removed.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
