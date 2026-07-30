# OPERATE-SPEC-003 skills work item

Umbrella specification: `SPEC-003`
Release participant: `@openplanr/skills@1.17.0`

The public `planr-operate` skill is a thin presentation adapter generated from
the pipeline contract. It presents CLI-owned question IDs and typed actions,
returns answers on bounded stdin, and treats an explicit request to run one
cycle as authority for its reversible native prepare/record/finalize/Chair/report
lifecycle. It stops at external provider, governance, planning, PLAN, SHIP, and
external-effect boundaries and uses only the supported evidence-diagnosis path.

The skill must not copy the questionnaire, infer an answer/default, edit
operating journals, inspect private evidence state, or invoke PLAN/SHIP
automatically. It may add `--yes` only to the exact digest-bound cycle start
selected by the user's explicit run request. It must present the concise brief
and per-lens Markdown/JSON reports; the dashboard is never the only output.
