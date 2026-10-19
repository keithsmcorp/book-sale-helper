"""Packs the docs/ files into the single apps-script/Index.html that Apps Script serves.

The page lives in docs/ (one copy, used by GitHub Pages too). After changing anything
in docs/, run:

    python build_appsscript.py

then paste apps-script/Index.html into the Apps Script "Index" file and redeploy.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "docs"
OUT = ROOT / "apps-script" / "Index.html"

# When Apps Script serves the page, it talks to the sheet directly, so no backend URL is needed.
GAS_CONFIG = "window.BOOK_TOOL_CONFIG = { backendUrl: '' }; // Served by Apps Script: uses google.script.run."


def inline_script(match):
    name = match.group(1)
    js = GAS_CONFIG if name == "config.js" else (WEB / name).read_text(encoding="utf-8")
    if "</script" in js.lower():
        sys.exit(f"{name} contains '</script' and can't be inlined safely.")
    return f"<script>\n/* ---- {name} ---- */\n{js}\n</script>"


def main():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = (WEB / "styles.css").read_text(encoding="utf-8")

    html, n_css = re.subn(r'<link rel="stylesheet" href="styles\.css">', lambda _: f"<style>\n{css}\n</style>", html)
    html, n_js = re.subn(r'<script src="([\w.\-]+\.js)"></script>', inline_script, html)

    if n_css != 1 or n_js < 5:
        sys.exit(f"Unexpected index.html layout (stylesheets: {n_css}, scripts: {n_js}).")
    leftover = re.findall(r'<(?:script|link)\b[^>]*(?:src|href)="(?!https?:|data:)[^"]+"', html)
    if leftover:
        sys.exit(f"Local files still referenced: {leftover}")

    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, {n_js} scripts inlined)")


if __name__ == "__main__":
    main()
