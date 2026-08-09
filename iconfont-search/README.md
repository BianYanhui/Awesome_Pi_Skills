# iconfont-search

Search and download SVG icons from [iconfont.cn](https://www.iconfont.cn/) (阿里巴巴矢量图标库)
via its public search API — **no login, no browser needed**. Returns clean, standalone `.svg`
files (inline style/class stripped) plus an optional HTML preview grid.

## Triggers

Use this skill when the user asks to search/download icons from iconfont, e.g.:

- 「图标从 iconfont 里面自己搜」
- 「从 iconfont 搜索/下载图标」
- 「去 iconfont 找几个 icon」
- "find / download icons from iconfont / iconfont.cn"

## Features

- Multi-keyword search in one call (Chinese & English keywords)
- Sorts: `updatedAt` (default), `name`, `heat` (popularity), `sales`
- Per-keyword output subdirectories; filename `<name>_<icon_id>.svg` (no collisions)
- `--preview` writes a `preview.html` grid so results can be eyeballed
- Skips existing files unless `--force`

## Usage

```bash
scripts/iconfont-search.py <keyword> [more keywords...] [options]

# Examples
scripts/iconfont-search.py home -n 10 -o ~/icons
scripts/iconfont-search.py 购物车 settings user -n 5 -s heat --preview -o ./assets/icons
```

| Option | Meaning |
|--------|---------|
| `-n, --count N` | Max icons per keyword (default 5) |
| `-o, --out DIR` | Output root dir (default `./iconfont_downloads`); each keyword → `<out>/<keyword>/` |
| `-s, --sort SORT` | `updatedAt` (default) \| `name` \| `heat` \| `sales` |
| `-f, --force` | Overwrite existing files |
| `--preview` | Also write `preview.html` grid |
| `-q, --quiet` | Only print file paths |

## How it works

Posts to iconfont's public search endpoint:

```
POST https://www.iconfont.cn/api/icon/search.json
{"q": "<keyword>", "sortType": "updatedAt", "page": 1, "pageSize": 20, "ctoken": ""}
```

Each result embeds the full SVG (`show_svg`), which is cleaned into a standalone document and
saved. No login/cookies required.

## Caveats

- Keep `--count` modest (≤ 20/keyword) — it's a public endpoint, don't hammer it.
- Licenses vary by icon (most are free / CC-family); verify per-icon license on iconfont.cn
  before commercial use.
