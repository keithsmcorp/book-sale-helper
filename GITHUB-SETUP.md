# Getting Book Sale Helper online with GitHub

By the end of this you will have:

- A **GitHub account**, which you'll reuse for other projects.
- **Git** and the **GitHub command-line tool** installed on this PC, so Claude can publish and update projects for you.
- The Book Sale Helper page live at **`https://YOUR-USERNAME.github.io/book-sale-helper/`**, working on any phone. It starts in Practice mode, which is fine for a demo.

Total time is about 20 minutes. Parts 1 and 3 need you, because only you can create your account and sign in. Claude can do Parts 2 and 4.

---

## Part 1 — GitHub account (you, about 5 minutes)

### 1a. Check whether you already have one
1. Go to **https://github.com/password_reset**.
2. Enter your usual email address and complete the check.
3. **If an email arrives** from GitHub, you have an account. Use the link to set a new password, then skip to **1c**.
   **If nothing arrives** within a few minutes (also check spam) and you've tried your other email addresses, go to **1b**.

### 1b. Create the account
1. Go to **https://github.com/signup**.
2. **Email:** enter your email, then click **Continue**.
3. **Password:** at least 15 characters, *or* at least 8 including a number and a lowercase letter. Save it in your password manager.
4. **Username:** this becomes part of your web addresses, e.g. username `keithsm` gives `https://keithsm.github.io/...`. Keep it short and lowercase. Letters, numbers and single hyphens only.
5. **Email preferences:** leave the box unticked, then click **Continue**.
6. Solve the **"Verify your account"** puzzle.
7. Click **Create account**.
8. GitHub emails you a **launch code** (8 digits). Type it in.
9. Sign in. If it asks questions about your team or interests, scroll down and click **Skip personalization**. If it asks you to pick a plan, choose **Free**.

### 1c. Turn on two-factor sign-in (recommended)
GitHub will soon require this anyway.
1. Click your picture (top right), then **Settings ▸ Password and authentication**.
2. Under **Two-factor authentication**, click **Enable two-factor authentication**.
3. Choose **Authenticator app**, scan the QR code with an app (Google Authenticator, Microsoft Authenticator, 1Password…), and type in the 6-digit code.
4. **Download the recovery codes** and keep them somewhere safe. They're the only way back in if you lose your phone.

---

## Part 2 — Install Git and the GitHub tool (Claude can do this, about 3 minutes)

Just tell Claude **"go ahead and install them"**. To do it yourself instead, run these two commands one at a time in a terminal:

```bash
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
```

```bash
winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
```

Each one shows a progress bar and ends with **"Successfully installed"**. If Windows asks *"Do you want to allow this app to make changes?"*, click **Yes**.

- **Git** keeps track of every version of a project's files.
- **GitHub CLI** (`gh`) connects this PC to your GitHub account.

---

## Part 3 — Sign this PC in to GitHub (you, about 2 minutes)

You only do this once per computer.

1. Open a **new** terminal. One that was already open won't find the new tools. Then run:
   ```bash
   gh auth login
   ```
2. Answer the questions with the arrow keys and **Enter**:

   | Question | Choose |
   |---|---|
   | Where do you use GitHub? | **GitHub.com** |
   | What is your preferred protocol for Git operations on this host? | **HTTPS** |
   | Authenticate Git with your GitHub credentials? | **Yes** |
   | How would you like to authenticate GitHub CLI? | **Login with a web browser** |

3. It shows a **one-time code** like `ABCD-1234`. Note it, then press **Enter**. A browser opens at github.com/login/device. If it doesn't, open that address yourself.
4. Sign in to GitHub if asked, type in the code, click **Continue**, then **Authorize github**.
5. The terminal should now say **✓ Logged in as YOUR-USERNAME**.

Then tell Claude: **"I'm signed in."**

---

## Part 4 — Publish the page (Claude does this, about 2 minutes)

When you say you're signed in, Claude will:

1. Move this project from the temporary folder this session uses to a permanent folder you choose (suggested: `Documents\GitHub\book-sale-helper`).
2. Set Git to record changes under your GitHub username, using GitHub's private "noreply" email so your real email stays private.
3. Create a **public** repository called `book-sale-helper` on your account and upload the project.
   - It has to be public for free GitHub Pages hosting. There are no passwords or keys in these files. API keys are stored in Google Apps Script, never here.
4. Turn on **GitHub Pages** for the `docs` folder.
5. Give you the live address. The first time, it takes 1–2 minutes before the page appears.

<details>
<summary>Doing Part 4 yourself in the browser instead (no Git needed)</summary>

1. On github.com, click **+** (top right) ▸ **New repository**.
2. **Repository name:** `book-sale-helper`. Choose **Public**. Leave everything else as is. Click **Create repository**.
3. On the next page, click the link **"uploading an existing file"**.
4. Open the project folder in File Explorer and drag in the **`docs` folder itself** (not just its contents), plus `apps-script`, `README.md`, `SETUP.md`, `GITHUB-SETUP.md` and `build_appsscript.py`. Click **Commit changes**.
5. Go to **Settings** (the tab above the file list) ▸ **Pages** (left sidebar).
6. Under **Build and deployment ▸ Branch**, choose **main**, then change the folder from `/ (root)` to **`/docs`**, and click **Save**.
7. Wait 1–2 minutes and refresh. A box at the top says **"Your site is live at …"**.
</details>

---

## Part 5 — Try it on your phone

1. Open **`https://YOUR-USERNAME.github.io/book-sale-helper/`** on your phone.
2. You'll see a yellow **Practice mode** banner. In Practice mode titles and covers are real, prices are made up, and nothing goes to a spreadsheet. The Settings PIN is **1234**.
3. Tap **📷 Scan barcode with camera** and allow camera access. Live scanning should work here, because it's a normal `https://` website.
4. Add it to your home screen so it opens like an app:
   - **iPhone (Safari):** Share button ▸ **Add to Home Screen**
   - **Android (Chrome):** ⋮ menu ▸ **Add to Home screen**

**A good 5-minute demo:**
1. **Quick Check:** scan a book and show the color circle, the price data and the "eBay sold" button.
2. Type a number into **Your price estimate** and watch the color change.
3. **One at a Time:** scan a book, pick Hardcover and Good, then **Save to list**. Scan the same book again to show the "Already on the list" warning.
4. **Rapid Scan:** scan 4–5 books quickly.
5. **⚙ Settings** (PIN 1234): change a value level and save, to show your wife what she can adjust.

---

## Part 6 — Later: connect the real spreadsheet

Practice mode is only for trying the tool out. To save books to the Google Sheet and get real eBay prices:

1. Paste `apps-script/Code.gs` into the sheet's Apps Script and deploy it as a web app. Only Code.gs is needed with GitHub; skip the Index file. See **SETUP.md**, steps 1–2.
2. Give Claude the Web app URL. Claude puts it in `docs/config.js` and publishes the change, and the yellow banner disappears.
3. Connect eBay (SETUP.md, step 4).

---

## Updating the page later

Ask Claude for a change. Claude edits the files, then runs `git commit` and `git push`, and the live page updates within a minute or two. Every version is kept on GitHub, so any change can be undone.
