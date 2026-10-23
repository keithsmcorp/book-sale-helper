# book-sale-helper: rules for this repo

Phone page for library book sale volunteers, with a Google Sheet + Apps Script backend.
What it is and the decisions behind it: `SPEC.md`. Setup and pricing: `SETUP.md`.

## This repo is PUBLIC
- Never commit personal data, API keys (eBay, Keepa), PINs, team codes, Sheet IDs
  or the Apps Script Web app URL. Keys and codes live in the Sheet's hidden Settings tab.
- `docs/config.js` stays with an empty `backendUrl` in git.

## Merging into main publishes the website
GitHub Pages serves `docs/` from `main` at https://keithsmcorp.github.io/book-sale-helper/.
Any change to `docs/` goes live on merge, so get the user's OK first.

## Changing the page
- The page's source is `docs/`. After changing it, run `py build_appsscript.py`
  to rebuild `apps-script/Index.html`.
- The live app runs from Apps Script, not from this repo: the user pastes `Code.gs`
  and `Index.html` into Apps Script and redeploys as a **New version** (keeps the URL).
- Test in Practice mode (empty `config.js`, local web server, PIN 1234).
