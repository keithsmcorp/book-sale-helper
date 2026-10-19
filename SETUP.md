# Book Sale Helper — setup guide

Everything lives in **one Google Sheet** in your Drive. The Apps Script attached to the sheet shows the scan page and does the work behind it.

| File | Goes where | What it is |
|---|---|---|
| `apps-script/Code.gs` | Apps Script, file **Code.gs** | The backend: looks up prices, keeps API keys private, writes rows |
| `apps-script/Index.html` | Apps Script, an HTML file named **Index** | The scan page volunteers use |

The `docs/` folder is the same page split into separate files. You only need it for the optional GitHub copy (step 7), or if the page gets changed (see "Changing the page").

Allow about 10 minutes the first time. Steps 1–3 get everything working. Step 4 adds eBay prices inside the page, and the eBay sign-up can take a day or two, so start it early.

The spreadsheet already exists: **Library Book Sale List**, in **Drive ▸ Claude ▸ Library Book Sale**.

---

## 1. Paste the two files (5 min)

1. Open **Library Book Sale List** and choose **Extensions ▸ Apps Script**.
2. **Code.gs:** delete the starter code, then paste in **all** of `apps-script/Code.gs`. To copy it, open the file in Notepad, then **Ctrl+A** and **Ctrl+C**.
3. **Index:** in the left sidebar click **＋ ▸ HTML**, type **`Index`** as the name (capital I, no `.html`), delete its starter text, and paste in **all** of `apps-script/Index.html`.
4. Click 💾 **Save**.

## 2. Publish it (3 min)

1. Click **Deploy ▸ New deployment**.
2. Click the ⚙ next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
   - "Anyone" means volunteers don't need Google accounts. The team code (step 3) is what keeps strangers out.
4. Click **Deploy**. Google will ask for permission: **Authorize access ▸ choose your account ▸ Advanced ▸ Go to (project) ▸ Allow**. The warning appears because it's your own unpublished script.
5. Copy the **Web app URL**. It ends in `/exec`. **That's the scan page.**

> **When you change Code.gs or Index later:** go to **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: New version ▸ Deploy**. Doing it this way keeps the same URL. Choosing "New deployment" creates a new URL.

## 3. Open it and lock it down

1. Open the Web app URL. The first visit sets up the **Books**, **Sales** and (hidden) **Settings** tabs in the sheet by itself, which takes a few seconds.
2. Tap **⚙**, enter the starting PIN **`1234`**, and scroll to **Access**:
   - **New team code:** something simple, like `library2026`.
   - **New Settings PIN:** your wife's PIN.
   - Click **Save settings**.
3. Reload the spreadsheet. A **📚 Book Tool** menu appears there too, with "Fill in missing lookups" and backup ways to set the code and PIN.

Google shows a small grey bar at the top of the page: *"This application was created by another user."* That's normal for Apps Script pages and can't be removed.

## 4. Connect eBay (free; sign-up takes 1–2 days)

This puts current eBay listings, and the color guess based on them, inside the page. Until it's connected, the page still works: titles, covers and all the price links. The circle shows "No data" until a volunteer types an estimate.

1. Go to **developer.ebay.com** and sign up with your eBay account (or a new one). Approval can take a day or so.
2. Under **Application Keys**, create a keyset. Use the **Production** keys, not "Sandbox".
3. eBay will ask about **Marketplace Account Deletion** notifications before turning on production keys. Choose the **exemption**: this tool doesn't store any eBay user data.
4. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**.
5. On the scan page: **⚙ ▸ PIN ▸ Price sources**. Paste both keys and click **Save settings**. It should say **"eBay is connected."**

## 5. Share with volunteers

- **⚙ Settings ▸ Access** shows a **"Link for volunteers"**: the web app URL with `?team=…` on the end. Text or email that link.
- Ask volunteers to **add that link to their home screen**. Always opening it from there keeps them signed in with the team code.
  - **iPhone (Safari):** Share button ▸ **Add to Home Screen**
  - **Android (Chrome):** ⋮ menu ▸ **Add to Home screen**
- Add their names under **⚙ Settings ▸ Volunteers** so they tap their name instead of typing it.

## 6. Barcode scanners and the phone camera

- **USB scanner + computer:** plug it in and open the page. Scanning works anywhere on the page, even when the cursor is in another box. No setup needed.
- **Bluetooth scanner + phone or tablet:** pair it in the phone's Bluetooth settings. It needs to be in **keyboard / HID mode**, which is the default on most scanners. Then scan with the page open.
- **Phone camera:** tap **📷 Scan barcode with camera**. The page first tries live scanning (point and it reads by itself). **Apps Script pages often aren't allowed to use the camera directly**, so if the phone blocks it, the page offers **"Take a photo"** instead. That opens the normal camera app, and the page reads the barcode from the picture. After that, the camera button goes straight to the photo method.
- **Old paperbacks** often have a store barcode (UPC) on the front. The page will say so. The real ISBN is on the back cover or the copyright page.

## 7. Optional: a GitHub copy for live camera scanning

If taking photos turns out to be too slow and you want point-and-scan on phones, put a copy of the page on GitHub Pages (free). It uses the **same sheet, settings and keys**, and both links can be used at the same time.

> **Full step-by-step instructions, including creating a GitHub account, are in GITHUB-SETUP.md.** The short version is below.

1. In `docs/config.js`, paste the Web app URL between the quotes: `backendUrl: 'https://script.google.com/macros/s/XXXX/exec',`
2. Create a free account at github.com, then click **New repository**. Name it `book-sale-helper`, make it **Public**, and create it.
3. Click **uploading an existing file** and drag in **everything inside the `docs` folder**. Click **Commit changes**.
4. Go to **Settings ▸ Pages**. Under Branch, choose **main** and **/(root)**, then **Save**.
5. After a minute or two, open `https://YOUR-NAME.github.io/book-sale-helper/`. Opened from there, **⚙ Settings ▸ Access** gives a volunteer link for that copy.

Volunteers who switch links will be asked for the team code and their name once more. Phones remember those per web address.

## 8. Optional: Keepa (Amazon prices, about $20/month)

Sign up at keepa.com and buy an API plan. Then go to **⚙ Settings ▸ Price sources**: paste the key, tick **Use Keepa**, and save. The page then shows Amazon's used price, 90-day average and sales rank. The sales rank is a good sign of how often a book sells. When eBay has no listings, the system guess uses Amazon's used price instead. To stop paying, untick it and cancel on Keepa's site.

---

## How the pricing works

- **Value** = the volunteer's own estimate if they typed one, otherwise the **system guess**.
- **System guess** = the middle eBay *asking* price × 70%. Asking prices run higher than what books actually sell for, and the 70% can be changed in Settings. eBay doesn't offer sold prices for free, so the **✅ eBay sold** button opens eBay's own sold search for a real check. That search covers about the last 90 days.
- **Value levels:** ⚪ Standard (under $5) · 🟢 Good Find ($5+) · 🟡 Valuable ($15+) · 🟣 High Value ($40+). Names and amounts can be changed in Settings.
- **Dashed ring / "Not much data":** there were fewer than 3 eBay listings, so treat the color as a rough guess.
- **Suggested sale price:** Standard books get a flat price by format ($1 paperback, $2 hardcover, 50¢ mass-market). Higher levels are priced at 50% of value, rounded to 50¢. All of this can be changed in Settings. When you get the library's real pricing scheme, put it here.
- **Where to sell:** "Online" at $40+, otherwise "Book sale". It can be switched off in Settings.

## Working in the spreadsheet

- **Change a book's price:** type into **Your estimate**. Value, color, suggested price and where-to-sell all update by themselves.
- **Override "Where to sell" or "Value level":** type over the cell.
- **Don't rename or reorder the existing columns.** New columns can go at the far right.
- **Changed thresholds** in Settings recolor every row automatically.
- **📚 Book Tool ▸ Fill in missing lookups** retries any Rapid Scan rows whose price lookup didn't finish (status "Pending").
- Google Sheets keeps full version history (**File ▸ Version history**) in case something gets messed up.

## Changing the page

The page's source is in `docs/`. After any change there:

```
python build_appsscript.py
```

That rebuilds `apps-script/Index.html`. Paste the new copy into the Apps Script **Index** file and redeploy as a **New version** (step 2). If you use the GitHub copy, upload the changed `docs/` files there too.

## Practice mode

Open `docs/index.html` from a local web server with an empty `config.js` to get Practice mode. Titles and covers are real, prices are made up (but the same every time for a given book), and nothing is saved to the sheet. The Practice PIN is `1234`. It's useful for training volunteers without touching the real list.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Enter the team code" keeps appearing | The code was changed, or they opened the page without the `?team=` link. Send the link from Settings ▸ Access again. |
| "Can't reach the spreadsheet" | Check the phone's internet, and make sure the deployment is set to **Anyone**. |
| Page says "No HTML file named Index was found" or is blank | The HTML file must be named exactly **Index**. Save, then redeploy as a New version. |
| Camera goes straight to "Take a photo" | Expected on Apps Script pages. For live scanning, use the GitHub copy (step 7). |
| "eBay did not accept the keys" | Make sure they're the **Production** keys, and that eBay finished approving the account. |
| Changes don't show up | Redeploy as a **New version** (step 2). |
| Title not found | Common for older or small-press books. The price links still work, and volunteers can type their own estimate. |
