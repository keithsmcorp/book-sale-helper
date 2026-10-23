# Book Sale Helper

A phone-friendly tool for library book sale volunteers. Scan or type a book's ISBN to see what it's worth, then save it to a shared Google Sheet.

- **`docs/`**: the scan page. GitHub Pages publishes this folder as the website.
- **`apps-script/Code.gs`**: the Google Sheet backend (eBay lookups, saving books and sales).
- **`apps-script/Index.html`**: the same page packed into one file, for serving it from Apps Script instead. Rebuild it with `py build_appsscript.py`.
- **`GITHUB-SETUP.md`**: getting the page online with GitHub Pages.
- **`SPEC.md`**: what the tool is, decisions made, roadmap.
- **`SETUP.md`**: connecting the Google Sheet and eBay, how pricing works, and troubleshooting.

While `docs/config.js` has no backend URL, the page runs in **Practice mode**: real titles and covers, made-up prices, nothing saved to the sheet. The Settings PIN in Practice mode is `1234`.
