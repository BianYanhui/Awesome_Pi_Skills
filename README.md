# Awesome_Pi_Skills

A curated collection of [pi](https://github.com/earendil-works/pi) agent skills.

## Skills

| Skill | Description |
|-------|-------------|
| [double-check](double-check/README.md) | Completes your task with the current (main) model, then has a **different** model (preferring the latest: MiniMax → MiniMax-M3, DeepSeek → deepseek-v4-flash) independently check the result; revises and re-checks on failure (max 3 rounds), and reports which main/check models were used. |

## Installing a skill

```bash
# symlink (recommended — updates follow the repo)
ln -s "$PWD/double-check" ~/.agents/skills/double-check

# or copy
cp -r double-check ~/.agents/skills/
```

Then use it in pi by mentioning it (e.g. "用 double-check 检查一下…") or via `/skill:double-check <task>`.
