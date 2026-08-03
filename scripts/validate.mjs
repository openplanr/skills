import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const pluginManifestPath = join(root, '.claude-plugin', 'plugin.json');
const pluginManifest = existsSync(pluginManifestPath)
  ? JSON.parse(readFileSync(pluginManifestPath, 'utf8'))
  : null;
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const names = new Set();
const errors = [];
// Two skill classes ship from this repository (FR2):
//   - portable workflow skills, held to the runtime-neutral leak check below;
//   - the planning skill, which is shipped but exempt from the leak check
//     because documenting per-runtime routing is its subject matter, not a leak.
// A skill directory must belong to exactly one class, or the suite fails — a new
// directory can never auto-ship into either class unnoticed.
const expectedPortableSkills = new Set([
  'openplanr-unified',
  'planr-artifact',
  'planr-plan',
  'planr-design',
  'planr-ship',
  'planr-dashboard',
  'planr-sync',
  'planr-doctor',
  'planr-operate',
]);
const expectedShippedSkills = new Set(['openplanr']);
const declaredSkills = new Set([...expectedPortableSkills, ...expectedShippedSkills]);
const operateSkillPath = join(root, 'skills', 'planr-operate', 'SKILL.md');

if (packageJson.version !== marketplace.metadata?.version) {
  errors.push(
    `Version drift: package.json=${packageJson.version} marketplace=${marketplace.metadata?.version}`,
  );
}

const workspace = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(root, '..'));

// The package must name exactly one planr-pipeline version it mirrors. That
// declaration is a version pin only — the byte-parity mirror below carries the
// behaviour; no engine lifecycle is reimplemented here. It must agree with the
// checkout the mirror is generated from, the CI pins, and the implementation
// note, so the compatibility claim can never silently drift from reality.
const pipelineCompatibility = packageJson.pipelineCompatibility;
const compatMatch = /^planr-pipeline@(\d+\.\d+\.\d+)$/.exec(pipelineCompatibility ?? '');
if (!compatMatch) {
  errors.push(
    `package.json must declare "pipelineCompatibility": "planr-pipeline@<version>" (got ${JSON.stringify(pipelineCompatibility)})`,
  );
} else {
  const declaredPipelineVersion = compatMatch[1];
  const siblingPackagePath = join(workspace, 'planr-pipeline', 'package.json');
  if (existsSync(siblingPackagePath)) {
    const siblingVersion = JSON.parse(readFileSync(siblingPackagePath, 'utf8')).version;
    if (siblingVersion !== declaredPipelineVersion) {
      errors.push(
        `pipelineCompatibility names planr-pipeline@${declaredPipelineVersion} but the mirrored checkout is ${siblingVersion}`,
      );
    }
  }
  for (const workflow of ['validate.yml', 'release-check.yml']) {
    const workflowPath = join(root, '.github', 'workflows', workflow);
    if (
      existsSync(workflowPath) &&
      !readFileSync(workflowPath, 'utf8').includes(`ref: v${declaredPipelineVersion}`)
    ) {
      errors.push(`${workflow} does not pin planr-pipeline ref v${declaredPipelineVersion}`);
    }
  }
  const specNotePath = join(root, 'docs', 'implementation', 'OPERATE-SPEC-008.md');
  if (
    existsSync(specNotePath) &&
    !readFileSync(specNotePath, 'utf8').includes(`planr-pipeline@${declaredPipelineVersion}`)
  ) {
    errors.push(`OPERATE-SPEC-008.md does not name planr-pipeline@${declaredPipelineVersion}`);
  }
}

if (!pluginManifest) {
  errors.push('Missing stable Claude plugin manifest: .claude-plugin/plugin.json');
} else {
  if (pluginManifest.$schema !== 'https://json.schemastore.org/claude-code-plugin.json') {
    errors.push('Claude plugin manifest has an invalid $schema');
  }
  if (pluginManifest.name !== 'openplanr') {
    errors.push(`Claude plugin identity drift: expected openplanr, got ${pluginManifest.name}`);
  }
  if (pluginManifest.version !== packageJson.version) {
    errors.push(
      `Version drift: package.json=${packageJson.version} plugin.json=${pluginManifest.version}`,
    );
  }
  if (pluginManifest.repository !== 'https://github.com/openplanr/skills') {
    errors.push(`Claude plugin repository drift: ${pluginManifest.repository}`);
  }
}

if ((marketplace.plugins ?? []).length !== 1 || marketplace.plugins[0]?.name !== 'openplanr') {
  errors.push('Marketplace must expose exactly one stable openplanr plugin identity');
}

for (const plugin of marketplace.plugins ?? []) {
  for (const relative of plugin.skills ?? []) {
    const skillPath = join(root, relative, 'SKILL.md');
    if (!existsSync(skillPath)) {
      errors.push(`Missing skill: ${relative}`);
      continue;
    }
    const text = readFileSync(skillPath, 'utf8');
    const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    if (!name) errors.push(`${relative} has no frontmatter name`);
    else if (names.has(name)) errors.push(`Duplicate skill name: ${name}`);
    else names.add(name);
    // The leak check applies to portable workflow skills only. The planning
    // skill is exempt: it is permitted to describe per-runtime routing, which is
    // exactly the content this regex would otherwise flag.
    if (
      !(name && expectedShippedSkills.has(name)) &&
      /CLAUDE_PLUGIN_ROOT|Sonnet|Opus|persona role-shift/.test(text)
    ) {
      errors.push(`${relative} contains a runtime-specific portable-workflow leak`);
    }
    // The nested-executable check applies to every skill regardless of class.
    if (/^\s*planr-pipeline\s+/m.test(text) || /`planr-pipeline\s+[^`]+`/.test(text)) {
      errors.push(`${relative} invokes the nested planr-pipeline executable`);
    }
  }
}

// Every declared skill (either class) must appear in the marketplace list, and
// the list may contain nothing beyond the declared union. Dropping a still-shipped
// skill from marketplace.json therefore surfaces here as an explicit "missing".
for (const expected of declaredSkills) {
  if (!names.has(expected)) errors.push(`Marketplace is missing declared skill: ${expected}`);
}
for (const name of names) {
  if (!declaredSkills.has(name)) errors.push(`Unexpected undeclared skill: ${name}`);
}

// Installed-bundle contract (FR1/FR2 NFR): what actually ships is the set of real
// subdirectories under skills/ carrying a SKILL.md — not marketplace.json's stated
// intent, which is precisely what was wrong (nine declared, ten shipped). Assert the
// on-disk set is identical to the declared union. A new directory with no class is
// caught here as "undeclared" (it can never auto-ship), and a manifest regression
// that drops a still-installed skill is caught above as "missing".
const skillsDir = join(root, 'skills');
const realSkillNames = new Set(
  readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name),
);
for (const real of realSkillNames) {
  if (!declaredSkills.has(real)) {
    errors.push(`Undeclared skill directory would auto-ship: skills/${real}`);
  }
}
for (const declared of declaredSkills) {
  if (!realSkillNames.has(declared)) {
    errors.push(`Declared skill has no directory on disk: skills/${declared}`);
  }
}

// FR1 / FR6 (SPEC-007) — every converged workflow skill is a byte-parity mirror
// of planr-pipeline's canonical Codex adapter output, so a change to a workflow
// lands once upstream and cannot silently diverge here. The mirror carries
// exactly two intentional, tolerated differences from that source and nothing
// else:
//   1. a `license: MIT` frontmatter line the pipeline copy omits (planr-operate
//      already carries it on both sides);
//   2. the runtime-neutral `--runtime <active-runtime>` placeholder in place of
//      the Codex-specific adapter's `--runtime codex`, because this bundle ships
//      to every supported runtime, not just Codex (the planr-plan precedent).
// normalizeSkill collapses those two and only those two; any other differing
// byte in any mirrored skill is reported and named. This is the one checker for
// all six workflow skills — a generalization of the former single planr-operate
// comparison, not a second parallel one — so the convergence FR1 requires cannot
// decay now that the mirror lives one repository over.
const normalizeSkill = (text) =>
  text.replace(/^license: MIT\r?\n/m, '').replace(/--runtime codex\b/g, '--runtime <active-runtime>');
// normalizeSkill collapses `--runtime codex` to the neutral placeholder on BOTH
// sides, which is correct for the canonical Codex adapter (it is Codex-specific by
// construction) but leaves a hole on the mirror side: a literal `--runtime codex`
// hard-coded into a portable skill would normalize to the same string and pass byte
// parity silently, telling Claude Code and Cursor users to pass a Codex-only flag.
// This guard makes that tolerance safe by asserting the mirror side of every
// converged workflow skill uses the runtime-neutral placeholder, never a literal
// supported runtime name in a `--runtime` argument. It protects the class, not just
// the two skills (planr-plan, planr-ship) that carry a `--runtime` token today.
// planr-operate is exempt: T-002 deliberately excluded it from workflow convergence
// because it is runtime-differentiated, and it legitimately carries `runtime: codex`
// in its body (a binding token, not a `--runtime` argument).
const runtimeNeutralExempt = new Set(['planr-operate']);
const supportedRuntimeNames = ['claude-code', 'codex', 'cursor'];
const literalRuntimeArg = new RegExp(
  String.raw`--runtime\s+(?:${supportedRuntimeNames.join('|')})\b`,
);
for (const name of [
  'planr-plan',
  'planr-ship',
  'planr-operate',
  'planr-design',
  'planr-sync',
  'planr-dashboard',
]) {
  const mirrorPath = join(root, 'skills', name, 'SKILL.md');
  const canonicalPath = join(
    workspace,
    'planr-pipeline',
    'adapters',
    'codex',
    'skills',
    name,
    'SKILL.md',
  );
  if (existsSync(mirrorPath)) {
    const mirrorText = readFileSync(mirrorPath, 'utf8');
    // Runtime-neutrality guard — mirror side only, independent of the sibling
    // pipeline being present, so it never goes vacuous. The canonical adapter copy
    // is Codex-specific and legitimately carries `--runtime codex`; only the
    // cross-runtime mirror is held to the placeholder.
    if (!runtimeNeutralExempt.has(name)) {
      const literal = literalRuntimeArg.exec(mirrorText);
      if (literal) {
        errors.push(
          `Mirrored ${name} skill hard-codes "${literal[0]}"; a cross-runtime skill must use the neutral "--runtime <active-runtime>" placeholder, never a literal runtime name`,
        );
      }
    }
    if (existsSync(canonicalPath)) {
      const mirror = normalizeSkill(mirrorText);
      const canonical = normalizeSkill(readFileSync(canonicalPath, 'utf8'));
      if (mirror !== canonical) {
        errors.push(`Mirrored ${name} skill drifts from ${canonicalPath}`);
      }
    }
  }
}

if (existsSync(operateSkillPath)) {
  const operateSkill = readFileSync(operateSkillPath, 'utf8');
  const commands = operateSkill.match(/`planr[^`]*`/g) ?? [];
  for (const command of commands) {
    if (
      /^`planr\s/.test(command) &&
      !/^`planr operate(?:\s|`)/.test(command) &&
      command !== '`planr-pipeline`'
    ) {
      errors.push(`planr-operate references a non-operate command: ${command}`);
    }
  }
  // Wrap-insensitive: the skill is a generated mirror and its paragraph
  // wrapping may change between pipeline releases without changing meaning.
  const normalize = (text) => text.replace(/\s+/g, ' ');
  for (const required of [
    '# Planr Operate — Codex-native workflow',
    '## Default invocation',
    'planr operate inspect --json',
    'Never invoke another vendor runtime',
    'inspect the workspace first',
    'Never dump a questionnaire',
    'If the user says “find it from the project,” continue investigating',
    'CEO, CTO, CPO, CMO, COO, then',
    'flexible `analysisMarkdown` plus',
    'planr operate report',
    'planr operate drafts',
    '`runtime: codex`',
    '`crossRuntimeFallback: false`',
    'Codex advisory isolation is supported',
    'planr operate harness prepare|record|finalize|resume|cancel',
    'operating-advisor-response@1.4',
    'E_OPERATE_DRAFT_UNAPPROVED',
    'Never deploy, publish, spend',
    // FR1 / FR6 — each advisor result is recorded the instant its role returns,
    // and a still-running role renews its session with the heartbeat action.
    'record each result the instant that role returns',
    'a slow lens cannot strand a finished one',
    'issue `harness heartbeat` to renew the session',
  ]) {
    if (!normalize(operateSkill).includes(normalize(required))) {
      errors.push(`planr-operate is missing boundary guidance: ${required}`);
    }
  }

  // FR1 — the recording contract must never reintroduce a batch/serial barrier
  // that waits for the whole board before recording any completed role.
  for (const barrier of [
    'record results serially',
    'record their exact results serially',
    'results serially against',
    'wait for all',
  ]) {
    if (normalize(operateSkill).includes(normalize(barrier))) {
      errors.push(`planr-operate reintroduces a batch recording barrier: ${barrier}`);
    }
  }

  // No engine lifecycle (lease/heartbeat/retry timing) may be reimplemented in
  // the skill prose — it names harness actions, it does not compute their math.
  if (/\b\d+\s*(?:ms|milliseconds?|seconds?|minutes?|hours?)\b/i.test(operateSkill)) {
    errors.push('planr-operate embeds a concrete lease/heartbeat duration; timing belongs in the engine');
  }

  for (const retired of [
    'rolePackPointer',
    'missionPacketPointer',
    'rolePack.roleBrief.output.jsonSchema',
    'operating-advisor-response@1.2.0',
    'operating-advisor-response@1.3.0',
    'planr operate adapter prepare',
    'planr operate evidence diagnose',
    'planr operate evidence classify',
    'planr operate sources test',
    'JSON/CSV import paths',
    'dispatch-mode-override',
  ]) {
    if (operateSkill.includes(retired)) {
      errors.push(`planr-operate references retired Protocol v1.2 guidance: ${retired}`);
    }
  }

  const questionnairePath = join(
    workspace,
    'planr-pipeline',
    'conformance',
    'fixtures',
    'guided-runtime-parity',
    'questionnaire.json',
  );
  if (existsSync(questionnairePath)) {
    const questionnaire = JSON.parse(readFileSync(questionnairePath, 'utf8'));
    for (const question of questionnaire.questions ?? []) {
      if (typeof question.label === 'string' && operateSkill.includes(question.label)) {
        errors.push(`planr-operate copies a CLI-owned question label: ${question.label}`);
      }
    }
  }
}

// FR7 (SPEC-007) — installation docs lead with `planr setup` as the front door,
// presenting the Claude Code plugin as one convenience channel, not the delivery
// mechanism. This block is independent of every check above: it reads a doc file,
// touches no shared state, and only appends to `errors`.
const installDocPath = join(root, 'docs', 'INSTALL.md');
if (existsSync(installDocPath)) {
  const installDoc = readFileSync(installDocPath, 'utf8');
  const heading = '## Claude Code';
  const sectionStart = installDoc.indexOf(heading);
  if (sectionStart === -1) {
    errors.push('docs/INSTALL.md is missing the "## Claude Code" section');
  } else {
    // Isolate the "## Claude Code" section: from its heading up to the next
    // level-2 heading. `\n## ` never matches a `### ` subheading, so Prerequisites,
    // Verify, and Local development stay inside the slice we assert over.
    const afterHeading = sectionStart + heading.length;
    const nextSectionOffset = installDoc.slice(afterHeading).indexOf('\n## ');
    const section =
      nextSectionOffset === -1
        ? installDoc.slice(sectionStart)
        : installDoc.slice(sectionStart, afterHeading + nextSectionOffset);
    const setupIndex = section.indexOf('planr setup');
    const marketplaceIndex = section.indexOf('/plugin marketplace add');
    if (setupIndex === -1) {
      errors.push('docs/INSTALL.md "## Claude Code" section never mentions `planr setup`');
    }
    if (marketplaceIndex === -1) {
      errors.push('docs/INSTALL.md "## Claude Code" section no longer shows the `/plugin marketplace add` path');
    }
    // The front-door ordering assertion: setup must appear before the raw plugin two-step.
    if (setupIndex !== -1 && marketplaceIndex !== -1 && setupIndex >= marketplaceIndex) {
      errors.push(
        'docs/INSTALL.md "## Claude Code" section leads with the raw `/plugin marketplace add` two-step; `planr setup` must come first (FR7)',
      );
    }
    // The plugin path must stay discoverable: both raw commands remain verbatim.
    for (const command of [
      '/plugin marketplace add openplanr/marketplace',
      '/plugin install openplanr@openplanr',
    ]) {
      if (!section.includes(command)) {
        errors.push(`docs/INSTALL.md "## Claude Code" section dropped the plugin command: ${command}`);
      }
    }
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
  process.exit(1);
}
process.stdout.write(
  `PASS ${names.size} skills validated (${expectedPortableSkills.size} portable + ${expectedShippedSkills.size} shipped)\n`,
);
