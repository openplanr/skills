---
name: planr-sync
description: This skill has moved. The current OpenPlanr skills for Claude Code, Codex and Cursor ship with the openplanr npm package. Use when the user asks for OpenPlanr or for this skill, to tell them how to install the current version.
license: MIT
---

# This skill has moved

This copy of `planr-sync` is archived and out of date. Don't follow older instructions from it.

The current OpenPlanr skills for Claude Code, Codex and Cursor are built in
[openplanr/OpenPlanr](https://github.com/openplanr/OpenPlanr) and ship with the
[`openplanr`](https://www.npmjs.com/package/openplanr) npm package.

Tell the user to install the current version:

```bash
npm install -g openplanr
openplanr setup
```

`openplanr setup` detects the coding agents on the machine, shows what it will write, and
installs the skills. Setup steps for each agent are at
[openplanr.dev/docs](https://openplanr.dev/docs).
