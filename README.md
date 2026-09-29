# Awesome_Pi_Skills

A curated collection of [pi](https://github.com/earendil-works/pi) agent skills, plus the
[`pi-from-codex`](pi-from-codex/) slash-command extension project kept as a self-contained
subdirectory.

## Skills

| Skill | Description |
|-------|-------------|
| [double-check](double-check/README.md) | Completes your task with the current (main) model, then has a **different** model (preferring the latest: MiniMax → MiniMax-M3, DeepSeek → deepseek-v4-flash) independently check the result; revises and re-checks on failure (max 3 rounds), and reports which main/check models were used. |
| [lastcall](lastcall/README.md) | **No silent exits** — leave a verifiable handoff before a context-heavy session stops. Distilled from [kimi-lastcall](https://github.com/kagamiurayama/kimi-lastcall) (MIT): the agent writes a 5-section handwritten handoff (current state / dead ends / unresolved / first next action / optional context) as a project file, marks it done with a session-bound marker, and the next session verifies and picks up. Fail-open, private state, audit = decisions only. |
| [iconfont-search](iconfont-search/README.md) | Search and download clean standalone SVG icons from iconfont.cn (阿里巴巴矢量图标库) via its public API — no login needed. Auto-triggers on requests like「图标从 iconfont 里面自己搜」/ "search icons on iconfont". Supports multi-keyword, sort by heat/name/date, HTML preview grid. |
| [handsoff-skill](handsoff-skill/README.md) | Keep `handsoff.md` at the repo root for the next agent. The header above the divider is written once; each handoff replaces only the section below it, including discussion, whether work is running, and the next step. |

### Installing a skill

```bash
# symlink (recommended — updates follow the repo)
ln -s "$PWD/double-check" ~/.agents/skills/double-check
ln -s "$PWD/iconfont-search" ~/.agents/skills/iconfont-search
ln -s "$PWD/handsoff-skill" ~/.agents/skills/handsoff-skill

# or copy
cp -r double-check ~/.agents/skills/
```

Then use it in pi by mentioning it (e.g. "用 double-check 检查一下…", "图标从 iconfont 里面自己搜")
or via `/skill:double-check <task>`.

## Slash commands — `pi-from-codex/`

[`pi-from-codex/`](pi-from-codex/) is a self-contained pi extension project (originally
[github.com/BianYanhui/Pi_from_Codex](https://github.com/BianYanhui/Pi_from_Codex)),
registering `/goal`, `/btw`, `/review`, `/diff`, `/plan` and the `goal_*` agent tools.

```bash
# install the extension from its own repository
pi install git:github.com/BianYanhui/Pi_from_Codex@main
```

Develop / test it in place:

```bash
cd pi-from-codex
npm install
npm test            # run the test suite (node:test + tsx)
npm run verify:pi   # smoke-test extension loading with pi itself
```

Its own [README](pi-from-codex/README.md) documents every command.

## License

- This repo's skills collection and README: [MIT](LICENSE).
- [`pi-from-codex/`](pi-from-codex/): [Apache-2.0](pi-from-codex/LICENSE) — portions derived
  from OpenAI Codex (Apache-2.0) and pi-goal concepts (MIT).
