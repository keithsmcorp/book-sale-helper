# Book Sale Helper: spec

What it is, the decisions behind it, and what's next. How to set it up is in
`SETUP.md`; getting the GitHub copy online is in `GITHUB-SETUP.md`.

## What it is

A phone-friendly tool for library book sale volunteers. Scan or type a book's ISBN,
see roughly what it's worth, and save it to a shared Google Sheet. Built Oct 19, 2026.

**Who uses it:** volunteers sorting donated books (on phones, or a computer with a
USB scanner), and an organizer who manages settings, keys and the volunteer list.

## How it's built

- **One Google Sheet** ("Library Book Sale List", in the organizer's Drive) holds
  the Books, Sales and hidden Settings tabs.
- **Apps Script** attached to the Sheet (`apps-script/Code.gs`) is the backend:
  price lookups, writing rows, keeping API keys private. It also serves the page
  (`apps-script/Index.html`) as the main web address.
- **`docs/`** is the same page split into files. GitHub Pages publishes it as an
  optional second copy, which allows live camera scanning (Apps Script pages often
  can't use the camera directly). Both copies use the same Sheet when `config.js`
  has the backend URL; with it empty, the GitHub copy runs in Practice mode.

## Decisions

- **Google Sheet + Apps Script, not a local web page.** Volunteers use it at the
  sale on their own phones, so it has to be on the internet; Sheets is where the
  organizer already works. (An exception to the home-tools "local web page" pattern.)
- **No Google accounts for volunteers.** The web app is open to "Anyone"; a team
  code in the link keeps strangers out, and a Settings PIN protects settings.
- **Keys stay in the Sheet's hidden Settings tab**, never in the page or the repo.
- **Pricing:** value = volunteer's estimate, else a system guess of the middle eBay
  asking price x 70%. Value levels Standard / Good Find ($5+) / Valuable ($15+) /
  High Value ($40+). Suggested sale price: flat by format for Standard, 50% of value
  above that. "Online" at $40+. All adjustable in Settings.
- **eBay sold prices aren't free**, so a button opens eBay's own sold search instead.
- **Keepa (Amazon prices)** is optional and paid (about $20/month).
- **Practice mode** (real titles and covers, made-up prices, nothing saved) for
  training volunteers.
- **Public repo**, so the GitHub Pages copy is free. Nothing private goes in it.

## Open questions

- The library's real pricing scheme (the Suggested sale price rules are placeholders).
- Is eBay connected, and is the GitHub copy wired to the backend or still Practice mode?

## Roadmap

(To fill in with the user.)
