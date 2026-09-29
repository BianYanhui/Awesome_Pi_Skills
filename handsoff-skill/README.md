# handsoff-skill

Keep a `handsoff.md` at the repo root so the next agent can resume without a verbal recap. The text above the divider is written once. Each later handoff replaces only the section below it.

## Triggers

- handsoff, handsoff_skill, handsoff-skill, 交接
- "update handsoff.md"

## What it records

Discussion, settled conclusions, and whether the work is not started, running, finished, or stopped. A running job includes its pid, command, log path, and progress. Code diffs are included when they exist, and omitted when they do not.

## Install

```bash
ln -s "$PWD/handsoff-skill" ~/.agents/skills/handsoff-skill
```
