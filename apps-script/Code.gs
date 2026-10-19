/**
 * Book Sale Helper — backend (Google Apps Script)
 *
 * Paste this whole file into the Google Sheet's Extensions ▸ Apps Script editor,
 * next to an HTML file named "Index" (apps-script/Index.html).
 * It does these jobs:
 *   0. Shows the scan page itself at the web app URL (Index.html).
 *   1. Answers the scan page (looks up eBay / Keepa prices, keeps API keys private).
 *   2. Writes books and sales into the sheet.
 *   3. Keeps the Settings tab that the scan page's Settings screen edits.
 * See SETUP.md for step-by-step instructions.
 */

const SHEETS = { books: 'Books', sales: 'Sales', settings: 'Settings' };

// Columns of the Books tab, in order: [key, header].
// The code finds columns by position, so add new columns at the END of this list.
const COLS = [
  ['id', 'Book ID'], ['added', 'Date added'], ['by', 'Scanned by'], ['mode', 'Added in'],
  ['isbn', 'ISBN'], ['title', 'Title'], ['author', 'Author'], ['year', 'Year'], ['publisher', 'Publisher'],
  ['cover', 'Cover'], ['format', 'Format'], ['condition', 'Condition'], ['special', 'First ed. / Signed'],
  ['copies', 'Copies'], ['sold', 'Copies sold'], ['searched', 'Priced as'],
  ['ebayCount', 'eBay # for sale'], ['ebayLow', 'eBay lowest asking'], ['ebayMedian', 'eBay median asking'],
  ['amzUsed', 'Amazon used (Keepa)'], ['amzRank', 'Amazon sales rank (Keepa)'],
  ['sysEst', 'System estimate'], ['basis', 'Estimate based on'],
  ['yourEst', 'Your estimate'], ['yourEstBy', 'Your estimate by'],
  ['value', 'Value used'], ['level', 'Value level'], ['suggested', 'Suggested price'], ['final', 'Final price'],
  ['where', 'Where to sell'], ['box', 'Box / location'], ['notes', 'Notes'],
  ['ebaySoldLink', 'eBay sold'], ['abeLink', 'AbeBooks'],
  ['looked', 'Last looked up'], ['status', 'Lookup status'], ['coverUrl', 'Cover URL'],
];
const C = {};
COLS.forEach(([k], i) => { C[k] = i + 1; });
const L = (k) => colLetter_(C[k]);

const SALES_COLS = ['Date', 'Sold by', 'Book ID', 'ISBN', 'Title', 'Price each', 'Qty'];

// Settings the Settings screen can change: [key, default, description].
const SETTINGS = [
  ['appName', 'Book Sale Helper', 'Name shown at the top of the scan page'],
  ['tier1Name', 'Standard', 'Value level 1 name (gray) — anything below level 2'],
  ['tier2Name', 'Good Find', 'Value level 2 name (green)'],
  ['tier2Min', 5, 'Value level 2 starts at this $ value'],
  ['tier3Name', 'Valuable', 'Value level 3 name (gold)'],
  ['tier3Min', 15, 'Value level 3 starts at this $ value'],
  ['tier4Name', 'High Value', 'Value level 4 name (purple)'],
  ['tier4Min', 40, 'Value level 4 starts at this $ value'],
  ['askingPct', 70, 'System estimate = median eBay asking price × this %'],
  ['lowDataMin', 3, 'Fewer listings than this shows "Not much data"'],
  ['whereOn', true, 'Fill in the "Where to sell" column'],
  ['onlineMin', 40, '"Where to sell" says Online at or above this $ value'],
  ['pricePaperback', 1, 'Sale price for level-1 paperbacks ($)'],
  ['priceHardcover', 2, 'Sale price for level-1 hardcovers ($)'],
  ['priceMassMarket', 0.5, 'Sale price for level-1 mass-market paperbacks ($)'],
  ['priceOther', 1, 'Sale price for level-1 books of other / unknown format ($)'],
  ['pricePct', 50, 'Books above level 1: sale price = value × this %'],
  ['priceMin', 1, 'Lowest suggested price for books above level 1 ($)'],
  ['priceRound', 0.5, 'Round suggested prices to the nearest ($)'],
  ['dupCheck', true, 'Warn when a scanned book is already on the list'],
  ['rapidDup', 'addCopy', 'Rapid Scan duplicates: addCopy = add 1 to Copies, newRow = new row'],
  ['beep', true, 'Beep when a book is scanned'],
  ['keepaOn', false, 'Use Keepa for Amazon prices (needs a Keepa key)'],
  ['volunteers', '', 'Volunteer names, one per line'],
];

const USED_IDS = '2750|3000|4000|5000|6000';
const NEW_IDS = '1000|1500';

/* ------------------------------------------------------------------ */
/* Web app entry points                                               */
/* ------------------------------------------------------------------ */

/** Opening the web app URL shows the scan page (the Index.html file in this project). */
function doGet(e) {
  if (e && e.parameter && e.parameter.status) {
    return json_({ ok: true, message: 'Book Sale Helper backend is running.' });
  }
  ensureSetup_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(getSettings_().appName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** The scan page calls this when it is served by Apps Script (google.script.run). JSON in, JSON out. */
function apiCall(json) {
  let out;
  try {
    out = route_(JSON.parse(json));
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return JSON.stringify(out);
}

/** A copy of the page hosted elsewhere (e.g. GitHub Pages) calls this instead. */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route_(req);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function route_(req) {
  ensureSetup_();
  const team = props_().getProperty('TEAM_CODE');
  if (team && String(req.team || '').trim().toLowerCase() !== team.trim().toLowerCase()) {
    return { ok: false, code: 'TEAM', error: 'The team code is missing or wrong.' };
  }
  switch (req.action) {
    case 'hello': return Object.assign({ ok: true }, publicSettings_());
    case 'lookup': return Object.assign({ ok: true }, lookup_(req));
    case 'save': return Object.assign({ ok: true }, withLock_(() => saveBook_(req)));
    case 'rapidSave': return Object.assign({ ok: true }, rapidSave_(req));
    case 'findBook': return Object.assign({ ok: true }, findBookForSale_(req));
    case 'markSold': return Object.assign({ ok: true }, withLock_(() => markSold_(req)));
    case 'adminLogin': checkPin_(req.pin); return Object.assign({ ok: true }, adminInfo_());
    case 'saveSettings': checkPin_(req.pin); return Object.assign({ ok: true }, saveSettingsReq_(req));
    default: return { ok: false, error: 'Unknown action: ' + req.action };
  }
}

/* ------------------------------------------------------------------ */
/* Lookups                                                            */
/* ------------------------------------------------------------------ */

function lookup_(req) {
  const s = getSettings_();
  const p = req.isbn ? parseIsbn_(req.isbn) : null;
  if (p && !p.ok) throw new Error('That ISBN does not look right.');
  const cond = req.condition === 'new' ? 'new' : 'used';
  const ebay = safe_(() => ebaySearch_(p, req.title, req.author, cond));
  const keepa = p && s.keepaOn ? safe_(() => keepa_(p.isbn13)) : null;
  const estimate = estimate_(ebay, keepa, s);
  const dup = s.dupCheck ? findBook_(p && p.isbn13, req.title, req.author) : null;
  return { ebay: ebay, keepa: keepa, estimate: estimate, dup: dup };
}

function fullLookup_(p, title, author, cond, s) {
  const meta = p ? safe_(() => serverMeta_(p)) : { title: title, author: author };
  const t = (meta && meta.title) || title;
  const a = (meta && meta.author) || author;
  const ebay = safe_(() => ebaySearch_(p, t, a, cond));
  const keepa = p && s.keepaOn ? safe_(() => keepa_(p.isbn13)) : null;
  return { meta: meta && !meta.error ? meta : null, ebay: ebay, keepa: keepa, estimate: estimate_(ebay, keepa, s) };
}

function estimate_(ebay, keepa, s) {
  const pct = Number(s.askingPct) / 100;
  if (ebay && ebay.median != null) {
    return {
      value: round2_(ebay.median * pct),
      basis: 'eBay asking prices (middle of ' + ebay.used + ') × ' + s.askingPct + '%',
      lowData: ebay.used < Number(s.lowDataMin),
    };
  }
  const k = keepa && (keepa.usedAvg90 || keepa.usedNow);
  if (k) {
    return { value: round2_(k * pct), basis: 'Amazon used price (Keepa) × ' + s.askingPct + '%', lowData: false };
  }
  return { value: null, basis: 'No price data found', lowData: true };
}

function ebayToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('ebay_token');
  if (cached) return cached;
  const id = props_().getProperty('EBAY_CLIENT_ID');
  const secret = props_().getProperty('EBAY_CLIENT_SECRET');
  if (!id || !secret) return null;
  const res = UrlFetchApp.fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(id + ':' + secret) },
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('eBay sign-in failed (' + res.getResponseCode() + '). Check the eBay keys in Settings.');
  }
  const j = JSON.parse(res.getContentText());
  cache.put('ebay_token', j.access_token, Math.max(60, Math.min(21600, (j.expires_in || 7200) - 300)));
  return j.access_token;
}

/** Current (active) eBay listings. eBay does not offer sold prices for free, so the page links out for those. */
function ebaySearch_(p, title, author, cond) {
  const token = ebayToken_();
  if (!token) return { notConfigured: true };
  const ids = cond === 'new' ? NEW_IDS : USED_IDS;
  const base = 'https://api.ebay.com/buy/browse/v1/item_summary/search?category_ids=267&limit=50' +
    '&filter=' + encodeURIComponent('conditionIds:{' + ids + '}');
  const tries = [];
  if (p) {
    tries.push(base + '&gtin=' + p.isbn13);
    tries.push(base + '&q=' + p.isbn13);
    if (p.isbn10) tries.push(base + '&q=' + p.isbn10);
  } else if (title) {
    tries.push(base + '&q=' + encodeURIComponent([title, author].filter(String).join(' ').slice(0, 95)));
  }
  let j = null;
  for (const url of tries) {
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('eBay search failed (' + res.getResponseCode() + ')');
    j = JSON.parse(res.getContentText());
    if (j.itemSummaries && j.itemSummaries.length) break;
  }
  const items = ((j && j.itemSummaries) || []).map((it) => {
    const pr = it.price || it.currentBidPrice || {};
    const ship = it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost;
    return {
      title: it.title,
      price: pr.currency === 'USD' ? Number(pr.value) : null,
      ship: ship && ship.currency === 'USD' ? Number(ship.value) : null,
      cond: it.condition || '',
      auction: (it.buyingOptions || []).indexOf('AUCTION') >= 0,
      url: it.itemWebUrl,
      img: (it.image && it.image.imageUrl) || (it.thumbnailImages && it.thumbnailImages[0] && it.thumbnailImages[0].imageUrl) || '',
    };
  }).filter((x) => x.price != null && x.price > 0);
  const prices = items.map((x) => x.price).sort((a, b) => a - b);
  items.sort((a, b) => a.price - b.price);
  return {
    total: (j && j.total) || items.length,
    used: prices.length,
    low: prices.length ? prices[0] : null,
    median: median_(prices),
    high: prices.length ? prices[prices.length - 1] : null,
    items: items.slice(0, 24),
  };
}

/** Amazon prices from Keepa (paid, optional). Keepa prices are in cents; -1 means none. */
function keepa_(isbn13) {
  const key = props_().getProperty('KEEPA_KEY');
  if (!key) return { notConfigured: true };
  const url = 'https://api.keepa.com/product?key=' + encodeURIComponent(key) + '&domain=1&stats=90&code=' + isbn13;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Keepa lookup failed (' + res.getResponseCode() + ')');
  const j = JSON.parse(res.getContentText());
  const prod = j.products && j.products[0];
  if (!prod) return { found: false };
  const st = prod.stats || {};
  const cur = st.current || [];
  const avg = st.avg90 || st.avg || [];
  const cents = (v) => (typeof v === 'number' && v > 0 ? v / 100 : null);
  return {
    found: true,
    usedNow: cents(cur[2]),
    usedAvg90: cents(avg[2]),
    newNow: cents(cur[1]),
    salesRank: typeof cur[3] === 'number' && cur[3] > 0 ? cur[3] : null,
    url: prod.asin ? 'https://www.amazon.com/dp/' + prod.asin : '',
    tokensLeft: j.tokensLeft,
  };
}

/** Title / author / cover for Rapid Scan and "Fill in missing lookups" (the page does this itself otherwise). */
function serverMeta_(p) {
  try {
    const res = UrlFetchApp.fetch('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN:' + p.isbn13, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const d = JSON.parse(res.getContentText())['ISBN:' + p.isbn13];
      if (d && d.title) {
        return {
          title: d.title + (d.subtitle ? ': ' + d.subtitle : ''),
          author: (d.authors || []).map((a) => a.name).join(', '),
          year: ((d.publish_date || '').match(/\d{4}/) || [''])[0],
          publisher: ((d.publishers || [])[0] || {}).name || '',
          coverUrl: (d.cover && (d.cover.medium || d.cover.small)) || '',
        };
      }
    }
  } catch (e) { /* fall through to Google Books */ }
  const res = UrlFetchApp.fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + p.isbn13, { muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    const j = JSON.parse(res.getContentText());
    // Only trust a result that really has this ISBN (Google's search can return other editions).
    const hit = (j.items || []).find((it) => ((it.volumeInfo || {}).industryIdentifiers || [])
      .some((x) => x.identifier === p.isbn13 || x.identifier === p.isbn10));
    const v = hit && hit.volumeInfo;
    if (v) {
      return {
        title: v.title + (v.subtitle ? ': ' + v.subtitle : ''),
        author: (v.authors || []).join(', '),
        year: (v.publishedDate || '').slice(0, 4),
        publisher: v.publisher || '',
        coverUrl: ((v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || '').replace('http:', 'https:'),
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Saving                                                             */
/* ------------------------------------------------------------------ */

function saveBook_(req) {
  const b = req.book || {};
  const sh = sheet_(SHEETS.books);
  if (req.dupId) {
    const found = findBook_(null, null, null, req.dupId);
    if (found) {
      const copies = (Number(found.copies) || 1) + (Number(b.copies) || 1);
      sh.getRange(found.row, C.copies).setValue(copies);
      if (b.yourEst != null && b.yourEst !== '' && sh.getRange(found.row, C.yourEst).getValue() === '') {
        sh.getRange(found.row, C.yourEst).setValue(Number(b.yourEst));
        sh.getRange(found.row, C.yourEstBy).setValue(b.by || '');
      }
      return { id: found.id, action: 'addedCopy', copies: copies };
    }
  }
  const added = appendBook_(b);
  return { id: added.id, action: 'added', copies: Number(b.copies) || 1 };
}

function rapidSave_(req) {
  const s = getSettings_();
  const p = req.isbn ? parseIsbn_(req.isbn) : null;
  if (p && !p.ok) throw new Error('That ISBN does not look right.');
  const cond = req.condition === 'new' ? 'new' : 'used';

  const dup = s.dupCheck ? findBook_(p && p.isbn13, req.title, req.author) : null;
  if (dup && s.rapidDup !== 'newRow') {
    const copies = withLock_(() => {
      const sh = sheet_(SHEETS.books);
      const n = (Number(sh.getRange(dup.row, C.copies).getValue()) || 1) + 1;
      sh.getRange(dup.row, C.copies).setValue(n);
      return n;
    });
    return { dup: true, id: dup.id, title: dup.title, copies: copies, value: dup.value, level: dup.level };
  }

  // Save the scan first so it is never lost, then fill in the details.
  const placed = withLock_(() => appendBook_({
    isbn13: p ? p.isbn13 : '', title: req.title || '', author: req.author || '',
    by: req.by, mode: 'Rapid Scan', searched: cond, copies: 1, status: 'Looking up…',
  }));
  try {
    const info = fullLookup_(p, req.title, req.author, cond, s);
    patchLookup_(placed.row, info, p, cond);
    const est = info.estimate;
    return {
      id: placed.id, dup: !!dup, title: (info.meta && info.meta.title) || req.title || '',
      value: est.value, lowData: est.lowData, ebayCount: info.ebay && info.ebay.used,
    };
  } catch (err) {
    sheet_(SHEETS.books).getRange(placed.row, C.status).setValue('Pending');
    return { id: placed.id, pending: true, error: String(err.message || err) };
  }
}

/** Writes lookup results into an existing row without disturbing the formulas or what people typed. */
function patchLookup_(row, info, p, cond) {
  const m = info.meta || {};
  const e = info.ebay && !info.ebay.error && !info.ebay.notConfigured ? info.ebay : {};
  const k = info.keepa && info.keepa.found ? info.keepa : {};
  const patch = {
    ebayCount: e.used != null ? e.used : '',
    ebayLow: e.low != null ? e.low : '',
    ebayMedian: e.median != null ? e.median : '',
    amzUsed: k.usedAvg90 || k.usedNow || '',
    amzRank: k.salesRank || '',
    sysEst: info.estimate.value != null ? info.estimate.value : '',
    basis: info.estimate.basis + (info.estimate.lowData && info.estimate.value != null ? ' (not much data)' : ''),
    looked: new Date(),
    status: info.meta || !p ? 'Done' : 'Book not found',
  };
  if (m.title) Object.assign(patch, { title: m.title, author: m.author, year: m.year, publisher: m.publisher, coverUrl: m.coverUrl });
  const links = linkFormulas_(p ? p.isbn13 : '', m.title || '', m.author || '', cond);
  patch.ebaySoldLink = links.ebay;
  patch.abeLink = links.abe;
  patchRow_(sheet_(SHEETS.books), row, patch);
}

function appendBook_(b) {
  const sh = sheet_(SHEETS.books);
  const id = nextId_();
  const row = Math.max(sh.getLastRow(), 1) + 1;
  const r = row;
  const vals = {};
  vals.id = id;
  vals.added = new Date();
  vals.by = b.by || '';
  vals.mode = b.mode || '';
  vals.isbn = b.isbn13 || '';
  vals.title = b.title || '';
  vals.author = b.author || '';
  vals.year = b.year || '';
  vals.publisher = b.publisher || '';
  vals.coverUrl = b.coverUrl || '';
  vals.format = b.format || '';
  vals.condition = b.condition || '';
  vals.special = b.special || '';
  vals.copies = Number(b.copies) || 1;
  vals.searched = b.searched === 'new' ? 'New' : b.searched === 'used' ? 'Used' : (b.searched || '');
  vals.ebayCount = b.ebayCount != null ? b.ebayCount : '';
  vals.ebayLow = b.ebayLow != null ? b.ebayLow : '';
  vals.ebayMedian = b.ebayMedian != null ? b.ebayMedian : '';
  vals.amzUsed = b.amzUsed || '';
  vals.amzRank = b.amzRank || '';
  vals.sysEst = b.sysEst != null ? b.sysEst : '';
  vals.basis = b.basis || '';
  vals.yourEst = b.yourEst != null && b.yourEst !== '' ? Number(b.yourEst) : '';
  vals.yourEstBy = vals.yourEst !== '' ? (b.yourEstBy || b.by || '') : '';
  vals.final = b.final != null && b.final !== '' ? Number(b.final) : '';
  vals.box = b.box || '';
  vals.notes = b.notes || '';
  vals.looked = b.sysEst != null || b.ebayCount != null ? new Date() : '';
  vals.status = b.status || 'Done';

  // Formulas: these follow the Settings tab, so changing a threshold re-colors every row.
  vals.cover = '=IF(' + L('coverUrl') + r + '="","",IMAGE(' + L('coverUrl') + r + '))';
  vals.sold = '=SUMIF(' + SHEETS.sales + '!C:C,' + L('id') + r + ',' + SHEETS.sales + '!G:G)';
  vals.value = '=IF(' + L('yourEst') + r + '<>"",' + L('yourEst') + r + ',IF(' + L('sysEst') + r + '<>"",' + L('sysEst') + r + ',""))';
  const V = L('value') + r;
  vals.level = '=IF(' + V + '="","No data",IF(' + V + '>=S_tier4Min,S_tier4Name,IF(' + V + '>=S_tier3Min,S_tier3Name,IF(' + V + '>=S_tier2Min,S_tier2Name,S_tier1Name))))';
  const F = L('format') + r;
  vals.suggested = '=IF(OR(' + V + '="",' + V + '<S_tier2Min),IF(' + F + '="Hardcover",S_priceHardcover,IF(' + F + '="Mass market",S_priceMassMarket,IF(' + F + '="Paperback",S_pricePaperback,S_priceOther))),MAX(S_priceMin,MROUND(' + V + '*S_pricePct/100,S_priceRound)))';
  vals.where = b.where ? b.where : '=IF(S_whereOn<>TRUE,"",IF(AND(' + V + '<>"",' + V + '>=S_onlineMin),"Online","Book sale"))';
  const links = linkFormulas_(b.isbn13 || '', b.title || '', b.author || '', b.searched);
  vals.ebaySoldLink = links.ebay;
  vals.abeLink = links.abe;

  sh.getRange(row, 1, 1, COLS.length).setValues([COLS.map(([k]) => (vals[k] == null ? '' : vals[k]))]);
  return { id: id, row: row };
}

function linkFormulas_(isbn13, title, author, cond) {
  const q = isbn13 || [title, author].filter(String).join(' ');
  if (!q) return { ebay: '', abe: '' };
  const isNew = String(cond).toLowerCase() === 'new';
  const ebay = 'https://www.ebay.com/sch/i.html?_sacat=267&LH_Sold=1&LH_Complete=1&_nkw=' + encodeURIComponent(q) +
    '&LH_ItemCondition=' + encodeURIComponent(isNew ? NEW_IDS : USED_IDS);
  const abe = isbn13
    ? 'https://www.abebooks.com/servlet/SearchResults?sortby=17&isbn=' + isbn13
    : 'https://www.abebooks.com/servlet/SearchResults?sortby=17&tn=' + encodeURIComponent(title || '') + '&an=' + encodeURIComponent(author || '');
  const hl = (url, label) => '=HYPERLINK("' + url.replace(/"/g, '""') + '","' + label + '")';
  return { ebay: hl(ebay, 'eBay sold'), abe: hl(abe, 'AbeBooks') };
}

/* ------------------------------------------------------------------ */
/* Finding books (duplicates, Mark Sold)                              */
/* ------------------------------------------------------------------ */

/** Finds a book already on the list by ISBN, by title + author, or by Book ID. */
function findBook_(isbn13, title, author, id) {
  const sh = sheet_(SHEETS.books);
  const last = sh.getLastRow();
  if (last < 2) return null;
  let row = 0;
  if (id || isbn13) {
    const col = id ? C.id : C.isbn;
    const hit = sh.getRange(2, col, last - 1, 1).createTextFinder(String(id || isbn13)).matchEntireCell(true).findNext();
    if (hit) row = hit.getRow();
  } else if (title) {
    const t = String(title).trim().toLowerCase();
    const a = String(author || '').trim().toLowerCase();
    const vals = sh.getRange(2, C.title, last - 1, 2).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim().toLowerCase() === t && (!a || String(vals[i][1]).trim().toLowerCase() === a)) { row = i + 2; break; }
    }
  }
  if (!row) return null;
  const v = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
  const get = (k) => v[C[k] - 1];
  return {
    row: row, id: get('id'), title: get('title'), author: get('author'), copies: get('copies'), sold: get('sold'),
    value: get('value') === '' ? null : get('value'), level: get('level'),
    suggested: get('suggested') === '' ? null : get('suggested'), final: get('final') === '' ? null : get('final'),
    box: get('box'),
  };
}

function findBookForSale_(req) {
  const p = req.isbn ? parseIsbn_(req.isbn) : null;
  return { book: findBook_(p && p.ok ? p.isbn13 : null, req.title, req.author) };
}

function markSold_(req) {
  const sh = sheet_(SHEETS.sales);
  const qty = Number(req.qty) || 1;
  const price = req.price === '' || req.price == null ? '' : Number(req.price);
  sh.appendRow([new Date(), req.by || '', req.id || '', req.isbn || '', req.title || '', price, qty]);
  return { recorded: true };
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function getSettings_() {
  const sh = ss_().getSheetByName(SHEETS.settings);
  const out = {};
  SETTINGS.forEach(([k, d]) => { out[k] = d; });
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
    if (!(k in out)) return;
    const d = out[k];
    if (typeof d === 'number') out[k] = v === '' ? d : Number(v);
    else if (typeof d === 'boolean') out[k] = v === true || String(v).toUpperCase() === 'TRUE';
    else out[k] = String(v);
  });
  return out;
}

function publicSettings_() {
  const P = props_();
  return {
    settings: getSettings_(),
    ebayReady: !!(P.getProperty('EBAY_CLIENT_ID') && P.getProperty('EBAY_CLIENT_SECRET')),
    keepaReady: !!P.getProperty('KEEPA_KEY'),
  };
}

function adminInfo_() {
  const P = props_();
  const sh = ss_().getSheetByName(SHEETS.books);
  return Object.assign(publicSettings_(), {
    secrets: {
      teamCodeSet: !!P.getProperty('TEAM_CODE'),
      adminPinIsDefault: !P.getProperty('ADMIN_PIN'),
      ebayIdSet: !!P.getProperty('EBAY_CLIENT_ID'),
      ebaySecretSet: !!P.getProperty('EBAY_CLIENT_SECRET'),
      keepaKeySet: !!P.getProperty('KEEPA_KEY'),
    },
    sheetUrl: ss_().getUrl(),
    appUrl: ScriptApp.getService().getUrl() || '',
    bookCount: sh ? Math.max(0, sh.getLastRow() - 1) : 0,
  });
}

function saveSettingsReq_(req) {
  const incoming = req.settings || {};
  const sh = sheet_(SHEETS.settings);
  const keys = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map((r) => r[0]);
  SETTINGS.forEach(([k, d]) => {
    if (!(k in incoming)) return;
    let v = incoming[k];
    if (typeof d === 'number') { v = Number(v); if (!isFinite(v)) throw new Error('"' + k + '" must be a number.'); }
    if (typeof d === 'boolean') v = v === true || v === 'true';
    const i = keys.indexOf(k);
    if (i >= 0) sh.getRange(i + 2, 2).setValue(v);
  });
  const sec = req.secrets || {};
  const P = props_();
  const setOrClear = (prop, val) => {
    if (val == null || val === '') return;
    if (val === '__clear__') P.deleteProperty(prop); else P.setProperty(prop, String(val).trim());
  };
  setOrClear('TEAM_CODE', sec.teamCode);
  setOrClear('ADMIN_PIN', sec.adminPin);
  setOrClear('EBAY_CLIENT_ID', sec.ebayId);
  setOrClear('EBAY_CLIENT_SECRET', sec.ebaySecret);
  setOrClear('KEEPA_KEY', sec.keepaKey);
  if (sec.ebayId || sec.ebaySecret) CacheService.getScriptCache().remove('ebay_token');
  applyFormatting_();

  let ebayTest = null;
  if (P.getProperty('EBAY_CLIENT_ID') && P.getProperty('EBAY_CLIENT_SECRET')) {
    try { ebayToken_(); ebayTest = 'ok'; } catch (e) { ebayTest = String(e.message || e); }
  }
  return Object.assign(adminInfo_(), { ebayTest: ebayTest });
}

function checkPin_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pinFails') || 0);
  if (fails >= 10) throw new Error('Too many wrong PINs. Wait 10 minutes and try again.');
  const real = props_().getProperty('ADMIN_PIN') || '1234';
  if (String(pin || '').trim() !== String(real)) {
    cache.put('pinFails', String(fails + 1), 600);
    throw new Error('That PIN is not right.');
  }
}

/* ------------------------------------------------------------------ */
/* Sheet setup + menu                                                 */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📚 Book Tool')
    .addItem('Set up / repair the sheet', 'setupSheets')
    .addItem('Fill in missing lookups', 'fillMissing')
    .addSeparator()
    .addItem('Set team code…', 'menuSetTeamCode')
    .addItem('Set Settings PIN…', 'menuSetPin')
    .addToUi();
}

/** First visit after pasting the code: build the tabs automatically, so nobody has to press Run. */
function ensureSetup_() {
  const ss = ss_();
  if (ss.getSheetByName(SHEETS.books) && ss.getSheetByName(SHEETS.settings)) return;
  withLock_(() => {
    if (!ss.getSheetByName(SHEETS.books) || !ss.getSheetByName(SHEETS.settings)) setupSheets();
  });
}

/** Creates (or repairs) the Books, Sales and Settings tabs. Safe to run more than once. */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  props_().setProperty('SHEET_ID', ss.getId());

  const books = ss.getSheetByName(SHEETS.books) || ss.insertSheet(SHEETS.books, 0);
  books.getRange(1, 1, 1, COLS.length).setValues([COLS.map((c) => c[1])])
    .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff').setWrap(true);
  books.setFrozenRows(1);
  books.setFrozenColumns(C.title);
  books.getRange(2, C.isbn, books.getMaxRows() - 1, 1).setNumberFormat('@');
  books.getRange(2, C.added, books.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd h:mm');
  books.getRange(2, C.looked, books.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd h:mm');
  ['ebayLow', 'ebayMedian', 'amzUsed', 'sysEst', 'yourEst', 'value', 'suggested', 'final'].forEach((k) => {
    books.getRange(2, C[k], books.getMaxRows() - 1, 1).setNumberFormat('$0.00');
  });
  books.setColumnWidth(C.title, 260);
  books.setColumnWidth(C.basis, 220);
  books.setColumnWidth(C.notes, 220);
  books.hideColumns(C.coverUrl);

  const sales = ss.getSheetByName(SHEETS.sales) || ss.insertSheet(SHEETS.sales);
  sales.getRange(1, 1, 1, SALES_COLS.length).setValues([SALES_COLS])
    .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  sales.setFrozenRows(1);
  sales.getRange(2, 1, sales.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd h:mm');
  sales.getRange(2, 4, sales.getMaxRows() - 1, 1).setNumberFormat('@');
  sales.getRange(2, 6, sales.getMaxRows() - 1, 1).setNumberFormat('$0.00');

  const st = ss.getSheetByName(SHEETS.settings) || ss.insertSheet(SHEETS.settings);
  const existing = {};
  if (st.getLastRow() > 1) {
    st.getRange(2, 1, st.getLastRow() - 1, 2).getValues().forEach(([k, v]) => { existing[k] = v; });
  }
  st.clear();
  st.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it does (change these on the Settings screen of the scan page)']])
    .setFontWeight('bold');
  const rows = SETTINGS.map(([k, d, desc]) => [k, k in existing && existing[k] !== '' ? existing[k] : d, desc]);
  st.getRange(2, 1, rows.length, 3).setValues(rows);
  st.setColumnWidth(1, 140); st.setColumnWidth(2, 160); st.setColumnWidth(3, 480);
  SETTINGS.forEach(([k], i) => ss.setNamedRange('S_' + k, st.getRange(i + 2, 2)));
  st.hideSheet();

  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  applyFormatting_();
  try { ss.toast('The Books, Sales and Settings tabs are ready.', 'Book Tool'); } catch (e) { /* run from editor */ }
}

/** Colors the "Value level" column to match the scan page. Re-run whenever level names change. */
function applyFormatting_() {
  const ss = ss_();
  const books = ss.getSheetByName(SHEETS.books);
  if (!books) return;
  const s = getSettings_();
  const range = books.getRange(2, C.level, books.getMaxRows() - 1, 1);
  const keep = books.getConditionalFormatRules().filter((r) =>
    !r.getRanges().some((g) => g.getColumn() === C.level));
  const rule = (text, bg, fg) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setBold(true).setRanges([range]).build();
  keep.push(
    rule(s.tier1Name, '#e5e7eb', '#374151'),
    rule(s.tier2Name, '#dcfce7', '#166534'),
    rule(s.tier3Name, '#fef3c7', '#92400e'),
    rule(s.tier4Name, '#ede9fe', '#5b21b6'),
    rule('No data', '#ffffff', '#9ca3af')
  );
  books.setConditionalFormatRules(keep);
}

/** Menu: looks up any rows saved without prices (e.g. Rapid Scan rows that timed out). */
function fillMissing() {
  const s = getSettings_();
  const sh = sheet_(SHEETS.books);
  const last = sh.getLastRow();
  if (last < 2) return;
  const started = Date.now();
  const vals = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  let done = 0;
  for (let i = 0; i < vals.length; i++) {
    if (Date.now() - started > 4.5 * 60 * 1000) break;
    const v = vals[i];
    const status = String(v[C.status - 1]);
    const needs = /Pending|Looking up/.test(status) || (!status && !v[C.title - 1] && v[C.isbn - 1]);
    if (!needs) continue;
    const isbn = String(v[C.isbn - 1]);
    const p = isbn ? parseIsbn_(isbn) : null;
    const cond = String(v[C.searched - 1]).toLowerCase() === 'new' ? 'new' : 'used';
    try {
      const info = fullLookup_(p && p.ok ? p : null, v[C.title - 1], v[C.author - 1], cond, s);
      patchLookup_(i + 2, info, p && p.ok ? p : null, cond);
      done++;
    } catch (e) {
      sh.getRange(i + 2, C.status).setValue('Pending');
    }
  }
  try { ss_().toast('Filled in ' + done + ' book(s).', 'Book Tool'); } catch (e) { /* editor */ }
}

function menuSetTeamCode() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Team code', 'Volunteers type this once on each phone. Leave blank to remove the code (not recommended).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = r.getResponseText().trim();
  if (v) props_().setProperty('TEAM_CODE', v); else props_().deleteProperty('TEAM_CODE');
  ui.alert(v ? 'Team code saved.' : 'Team code removed — anyone with the link can use the tool.');
}

function menuSetPin() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Settings PIN', 'The PIN that opens the Settings screen on the scan page.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = r.getResponseText().trim();
  if (!v) return;
  props_().setProperty('ADMIN_PIN', v);
  ui.alert('Settings PIN saved.');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseIsbn_(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^0-9X]/g, '');
  if ((s.length === 15 || s.length === 18) && /^97[89]/.test(s)) s = s.slice(0, 13);
  const v13 = (x) => /^\d{13}$/.test(x) && x.split('').reduce((t, c, i) => t + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0;
  const v10 = (x) => /^\d{9}[\dX]$/.test(x) && x.split('').reduce((t, c, i) => t + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;
  if (s.length === 13 && /^97[89]/.test(s) && v13(s)) {
    let i10 = null;
    if (s.startsWith('978')) {
      const core = s.slice(3, 12);
      const c = (11 - core.split('').reduce((t, d, i) => t + Number(d) * (10 - i), 0) % 11) % 11;
      i10 = core + (c === 10 ? 'X' : String(c));
    }
    return { ok: true, isbn13: s, isbn10: i10 };
  }
  if (s.length === 10 && v10(s)) {
    const core = '978' + s.slice(0, 9);
    const c = (10 - core.split('').reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0) % 10) % 10;
    return { ok: true, isbn13: core + c, isbn10: s };
  }
  return { ok: false };
}

function patchRow_(sh, row, patch) {
  const range = sh.getRange(row, 1, 1, COLS.length);
  const vals = range.getValues()[0];
  const forms = range.getFormulas()[0];
  const out = vals.map((v, i) => forms[i] || v);
  Object.keys(patch).forEach((k) => { if (C[k]) out[C[k] - 1] = patch[k]; });
  range.setValues([out]);
}

function nextId_() {
  const P = props_();
  let n = Number(P.getProperty('NEXT_ID') || 0);
  if (!n) n = Math.max(1, sheet_(SHEETS.books).getLastRow());
  P.setProperty('NEXT_ID', String(n + 1));
  return 'B' + String(n).padStart(5, '0');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function safe_(fn) {
  try { return fn(); } catch (e) { return { error: String((e && e.message) || e) }; }
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(props_().getProperty('SHEET_ID'));
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Open the sheet and choose 📚 Book Tool ▸ Set up / repair the sheet.');
  return sh;
}

function props_() { return PropertiesService.getScriptProperties(); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function median_(arr) {
  if (!arr.length) return null;
  const m = Math.floor(arr.length / 2);
  return round2_(arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2);
}

function round2_(n) { return Math.round(n * 100) / 100; }

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
