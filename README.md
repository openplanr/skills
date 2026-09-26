# OpenPlanr skills have moved to openplanr/OpenPlanr

This repository is no longer maintained. The OpenPlanr skills for Claude Code, Codex, and
Cursor are now built in the [OpenPlanr repository](https://github.com/openplanr/OpenPlanr) and
ship with the [`openplanr`](https://www.npmjs.com/package/openplanr) npm package, together with
the deterministic `planr` CLI.

- **Install:** `npm install -g openplanr`, then `planr setup`. The
  [getting started guide](https://github.com/openplanr/OpenPlanr/blob/main/docs/getting-started.md)
  covers each coding agent.
- **Claude Code:** the `openplanr` plugin that used to install from this repository is replaced
  by the unified `planr` plugin, which `planr setup --runtime claude --scope user` installs.
- **Skill catalog:** every current skill, its triggers, and what it defers are listed in the
  [skill catalog](https://github.com/openplanr/OpenPlanr/blob/main/docs/generated/skills.md).
- **Questions and bugs:** use
  [Discussions](https://github.com/openplanr/OpenPlanr/discussions) and
  [issues](https://github.com/openplanr/OpenPlanr/issues) in openplanr/OpenPlanr.

The last version tagged in this repository is
[v1.26.2](https://github.com/openplanr/skills/tree/v1.26.2). Its history stays here for
reference.
