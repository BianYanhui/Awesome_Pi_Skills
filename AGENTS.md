# Awesome_Pi_Skills development

Guidelines for agents and humans working on this repository.

## Project layout

- `double-check/` — skill: task → different-model check → revise loop (max 3) → report.
- `iconfont-search/` — skill: search & download SVG icons from iconfont.cn (no login).
- `handsoff-skill/` — skill: create or refresh `handsoff.md` so the next agent can resume.
- `pi-from-codex/` — self-contained pi extension project (slash commands `/goal`, `/btw`,
  `/review`, `/diff`, `/plan` + `goal_*` tools), kept as its own package with its own
  `package.json`, `AGENTS.md`, and Apache-2.0 license. See its `AGENTS.md` for internals.
- Root files — collection-level docs and license; no root `package.json` (the repo is a
  folder of skills + one nested extension project, not a single npm package).

## Conventions

- Skills: each skill is a self-contained directory with `SKILL.md` (frontmatter `name` +
  `description`), optional `scripts/` and `README.md`. Keep paths in `SKILL.md` relative
  to the skill directory.
- Extension: treat `pi-from-codex/` as a separate project — keep its package.json/README/
  AGENTS.md self-consistent; run its tests with `npm test` from that directory.
- Licenses: repo root and skills are MIT; `pi-from-codex/` is Apache-2.0 (derived from
  OpenAI Codex).
- When adding a skill, update the table in `README.md`.
