#!/usr/bin/env python3
"""iconfont-search.py — search & download SVG icons from iconfont.cn (no login required).

Usage:
  iconfont-search.py <keyword> [more keywords...] [options]

Options:
  -n, --count N       Max icons per keyword (default 5)
  -o, --out DIR       Output root dir (default ./iconfont_downloads). Each keyword
                      gets a subdirectory <out>/<keyword>/
  -s, --sort SORT     Sort: updatedAt (default) | name | heat | sales
  -p, --page PAGE     Start page (default 1)
  -t, --token TOKEN   Optional ctoken (default "")
  -f, --force         Overwrite existing files (default: skip)
      --preview       Also write preview.html (grid of inline SVGs) per keyword dir
  -q, --quiet         Only print downloaded file paths

Examples:
  iconfont-search.py home -n 10 -o ~/icons
  iconfont-search.py 购物车 settings user -n 5 -s heat --preview -o ~/icons
"""
import argparse
import json
import os
import re
import sys
import urllib.request

API = "https://www.iconfont.cn/api/icon/search.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def search(q, page, page_size, sort_type, ctoken):
    body = json.dumps({"q": q, "sortType": sort_type, "page": page,
                       "pageSize": page_size, "ctoken": ctoken}).encode()
    req = urllib.request.Request(API, data=body, method="POST", headers={
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Referer": "https://www.iconfont.cn/search/index",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def clean_svg(show_svg):
    """Turn iconfont's inline show_svg into a clean standalone SVG."""
    svg = re.sub(r'\sclass="icon"', '', show_svg)
    svg = re.sub(r'\sstyle="[^"]*"', '', svg)
    svg = re.sub(r'\sversion="1\.1"', '', svg)
    svg = re.sub(r'(<svg[^>]*?)(>)', r'\1>\n', svg, count=1)
    return svg


def safe_name(name):
    return re.sub(r'[^\w\u4e00-\u9fff-]', '_', name) or "icon"


def download_keyword(kw, args, quiet):
    page, got, skipped, icons = args.page, 0, 0, []
    per_page = min(20, args.count)
    while got < args.count:
        try:
            resp = search(kw, page, per_page, args.sort, args.token)
        except Exception as e:
            print(f"[error] request failed for '{kw}': {e}", file=sys.stderr)
            return got, skipped, icons
        batch = (resp.get("data") or {}).get("icons") or []
        if not batch:
            break
        for ic in batch:
            if got >= args.count:
                break
            name = ic.get("name") or "icon"
            icon_id = ic.get("id")
            svg = clean_svg(ic.get("show_svg") or "")
            if not svg:
                skipped += 1
                continue
            fname = f"{safe_name(name)}_{icon_id}.svg"
            path = os.path.join(args.out, kw, fname)
            if os.path.exists(path) and not args.force:
                skipped += 1
                continue
            with open(path, "w", encoding="utf-8") as f:
                f.write(svg)
            icons.append({"name": name, "id": icon_id, "svg": svg, "path": path})
            got += 1
            if not quiet:
                print(f"[{kw}] {path}")
        if len(batch) < per_page or got >= args.count:
            break
        page += 1
    return got, skipped, icons


def write_preview(outdir, kw, icons):
    cells = []
    for ic in icons:
        cells.append(
            f'<div class="cell"><div class="svg">{ic["svg"]}</div>'
            f'<div class="label">{ic["name"]} · {ic["id"]}</div></div>'
        )
    html = f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>iconfont: {kw}</title>
<style>
body{{font-family:-apple-system,sans-serif;margin:24px;background:#f7f7f8;}}
h1{{font-size:18px;}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;}}
.cell{{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px;text-align:center;}}
.svg{{height:56px;display:flex;align-items:center;justify-content:center;}}
.svg svg{{width:40px;height:40px;}}
.label{{font-size:11px;color:#666;margin-top:8px;word-break:break-all;}}
</style></head><body>
<h1>iconfont: {kw} ({len(icons)} icons)</h1>
<div class="grid">{"".join(cells)}</div>
</body></html>"""
    preview_path = os.path.join(outdir, kw, "preview.html")
    with open(preview_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"[{kw}] preview: {preview_path}")


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("keywords", nargs="+", help="one or more search keywords")
    ap.add_argument("-n", "--count", type=int, default=5)
    ap.add_argument("-o", "--out", default="./iconfont_downloads")
    ap.add_argument("-s", "--sort", default="updatedAt",
                    choices=["updatedAt", "name", "heat", "sales"])
    ap.add_argument("-p", "--page", type=int, default=1)
    ap.add_argument("-t", "--token", default="")
    ap.add_argument("-f", "--force", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    total_got = total_skip = 0
    for kw in args.keywords:
        os.makedirs(os.path.join(args.out, kw), exist_ok=True)
        got, skipped, icons = download_keyword(kw, args, args.quiet)
        total_got += got
        total_skip += skipped
        if args.preview and icons:
            write_preview(args.out, kw, icons)
        if not args.quiet:
            print(f"[{kw}] done: {got} downloaded, {skipped} skipped")

    print(f"\nTotal: {total_got} icons downloaded to {args.out} "
          f"({total_skip} skipped)")


if __name__ == "__main__":
    main()
