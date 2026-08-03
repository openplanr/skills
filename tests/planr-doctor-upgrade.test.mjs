import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = join(root, 'skills', 'planr-doctor');
const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(skillRoot, 'references', 'upgrade.md'), 'utf8');
const files = [
  ['skills/planr-doctor/SKILL.md', skill],
  ['skills/planr-doctor/references/upgrade.md', reference],
];

test('the upgrade instruction consumes pluginHalfCommands from the CLI, not a hardcoded list (FR4)', () => {
  // (a) The skill names the CLI-owned field it must read, in both the load-bearing
  // instruction and the walkthrough — proof it takes the command list from the
  // engine dynamically rather than embedding its own copy.
  assert.match(skill, /pluginHalfCommands/, 'SKILL.md must name the pluginHalfCommands field');
  assert.match(reference, /pluginHalfCommands/, 'the walkthrough must name the pluginHalfCommands field');
});

test('neither the skill nor its reference hardcodes a plugin command of its own (FR4 no-drift)', () => {
  // (b) The no-hardcoding proof: no literal backticked `claude plugin ...` command
  // string may appear in either file. The command list is the CLI's to own;
  // embedding a copy is the exact drift the CLI-side formatter exists to prevent.
  for (const [name, text] of files) {
    assert.doesNotMatch(text, /`claude plugin /, `${name} embeds a hardcoded plugin command`);
  }
});

test('the marketplace refresh is documented as always running first (FR4 stale-reinstall contract)', () => {
  // (c) Refresh-first is the mechanism; the contract it serves is "without it the
  // installer reinstalls the stale version." Both must be present (Trap E), or a
  // literal reading could satisfy the letter and reintroduce the bug.
  const combined = `${skill}\n${reference}`;
  assert.match(combined, /marketplace refresh/i, 'the refresh step must be named');
  assert.match(combined, /must run first|runs first|position 0/i, 'refresh must be documented as first');
  assert.match(
    combined,
    /reinstalls the cached, stale version/i,
    'the stale-reinstall contract the refresh serves must be named',
  );
});

test('the skill re-runs status afterward and reports the real before/after diff (FR4)', () => {
  // (d) The post-check: verification comes from a second `planr upgrade status
  // --json` read, and the report states only what actually moved — not an
  // assumed outcome derived from the commands that were issued.
  const combined = `${skill}\n${reference}`;
  assert.match(skill, /Re-run `planr upgrade status --json`/, 'the skill must re-run status after upgrading');
  assert.match(combined, /before state/i, 'the before state must be captured for comparison');
  assert.match(
    combined,
    /Report only what actually moved|report the real diff|report the real difference/i,
    'the report must reflect the real diff, not an assumed one',
  );
});
