---
name: iconfont-search
description: >-
  Search and download SVG icons from iconfont.cn (阿里巴巴矢量图标库) via its public search API,
  no login required. Use when the user asks to search/download icons from iconfont — e.g.
  "图标从 iconfont 里面自己搜", "从 iconfont 搜索图标", "去 iconfont 下载图标", "iconfont 找几个
  icon", "用 iconfont 的图标", "从 iconfont 搜 xxx", "find icons on iconfont", "download icons
  from iconfont.cn", or when the user says the agent should fetch icons itself from iconfont
  to use in code/UI/markdown/slides. The skill downloads clean standalone .svg files (inline
  style/class stripped) plus an optional HTML preview grid, and can take multiple keywords
  in one call.
---

# IconFont Search & Download

Search `iconfont.cn` (阿里巴巴矢量图标库) and download icons as clean standalone `.svg` files
directly into the project / user-specified directory — no login, no browser needed.

All script paths below are relative to this skill's directory (the directory containing this
`SKILL.md`). Resolve them to absolute paths before running, e.g.
`cd "$(dirname <skill-dir>/SKILL.md)"` or use `<skill-dir>/scripts/iconfont-search.py`.

## When to use

- The user wants icons for code, UI mockups, markdown docs, slides, websites, etc. and mentions
  iconfont (or says "you search the icons yourself from iconfont").
- The user names specific icons to fetch (e.g. "搜一个 home、购物车、settings 的图标").

## Usage

```bash
<skill-dir>/scripts/iconfont-search.py <keyword> [more keywords...] [options]
```

| Option | Meaning |
|--------|---------|
| `-n, --count N` | Max icons per keyword (default 5) |
| `-o, --out DIR` | Output root dir (default `./iconfont_downloads`); each keyword → `<out>/<keyword>/` |
| `-s, --sort SORT` | `updatedAt` (default) \| `name` \| `heat` (popularity) \| `sales` |
| `-f, --force` | Overwrite existing files (default: skip duplicates) |
| `--preview` | Also write `preview.html` — a grid of the downloaded SVGs, open it to eyeball results |
| `-q, --quiet` | Only print file paths |

### Examples

```bash
# 3 keywords, 5 each, by popularity, with preview
<skill-dir>/scripts/iconfont-search.py 购物车 home settings -n 5 -s heat --preview -o ./assets/icons

# Single keyword into a project dir
<skill-dir>/scripts/iconfont-search.py user -n 10 -o ./src/assets/icons
```

## Workflow

1. **Extract keywords** — parse the user's request into one or more icon keywords (Chinese and/or
   English; keep the user's exact wording when it's already a keyword).
2. **Pick output dir** — a sensible project-relative folder (`assets/icons`, `src/assets/icons`,
   `public/icons`…) unless the user specified one.
3. **Run the script** (multi-keyword in one call is fine).
4. **Verify** — open `preview.html` if generated, or spot-check a couple of downloaded SVGs
   (they are self-contained `<svg>` documents, ready to inline or reference).
5. **Use the icons** — inline the SVG directly, copy to a static assets dir, or hand the paths
   to the user. Report the exact file paths and count in your final answer.
6. **Pick good matches** — search returns many variants; prefer icons whose `name` matches the
   keyword exactly and whose SVG looks right for the context (style, line weight, multi-color vs
   monochrome). If results look wrong, try different keywords or sort by `heat`.

## Notes & caveats

- The script calls iconfont's public search API (`https://www.iconfont.cn/api/icon/search.json`).
  Keep `--count` modest (≤ 20 per keyword) and don't hammer it with many repeated runs.
- Icons are user-uploaded; licenses vary (many are free / CC-family). For commercial use, check
  the specific icon's license page on iconfont.cn (`https://www.iconfont.cn/collections/detail?cid=<id>`).
- Filenames are `<name>_<icon_id>.svg` — the id guarantees uniqueness.
- If the API returns an error, retry once; the endpoint sometimes throttles rapid requests.
