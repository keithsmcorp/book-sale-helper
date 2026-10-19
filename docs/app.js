/* Book Sale Helper — scan page. Plain JavaScript, no build step. */
(() => {
  const CONFIG = window.BOOK_TOOL_CONFIG || {};
  // Served by Apps Script itself (the web app URL) — talk to the sheet through google.script.run.
  const IN_GAS = !!(window.google && google.script && google.script.run);
  const PRACTICE = !CONFIG.backendUrl && !IN_GAS;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------------- Local storage (per device conveniences only) ---------------- */
  const ls = {
    get(k, d = null) { try { const v = localStorage.getItem('bsh_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bsh_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  const S = {
    settings: Object.assign({}, window.DEFAULT_SETTINGS, ls.get('settings', {})),
    ebayReady: false, keepaReady: false,
    mode: ls.get('mode', 'quick'),
    cond: ls.get('cond', 'used'),
    who: ls.get('who', ''),
    current: null,   // the book on screen (Quick Check / One at a Time / Mark Sold)
    rapid: [],       // this session's Rapid Scan list
    queue: [], running: 0,
    admin: null,     // { pin, info } while Settings is open
    cam: null,
  };

  const MODE_HELP = {
    quick: 'Look up what a book is worth. <b>Nothing is saved</b> — good for checking prices during a sale.',
    detailed: 'Look up one book, add details like condition and number of copies, then <b>save it to the list</b>.',
    rapid: 'Scan book after book. <b>Each one is saved to the list</b> and its price fills in by itself.',
    sold: 'Scan a book as it sells. The sale is recorded on the <b>Sales</b> tab of the spreadsheet.',
  };
  const MODE_LABEL = { quick: 'Quick Check', detailed: 'One at a Time', rapid: 'Rapid Scan', sold: 'Mark Sold' };

  /* ---------------- Small helpers ---------------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null || n === '' || isNaN(n) ? '—' : '$' + (Number(n) % 1 === 0 ? Number(n).toFixed(0) : Number(n).toFixed(2)));
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const isFinePointer = window.matchMedia && matchMedia('(pointer: fine)').matches;

  let toastTimer;
  function toast(text, ms = 2600) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function setMsg(text, kind = '') {
    const m = $('#entryMsg');
    m.className = 'msg ' + kind;
    m.innerHTML = text || '';
  }

  let actx;
  function beep(ok = true) {
    if (!S.settings.beep) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = ok ? 880 : 220;
      g.gain.value = 0.12;
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (ok ? 0.12 : 0.35));
    } catch (e) { /* no audio */ }
    if (navigator.vibrate) navigator.vibrate(ok ? 50 : [80, 60, 80]);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ($(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  /* ---------------- Talking to the spreadsheet ---------------- */
  function gasCall(payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), 45000);
      google.script.run
        .withSuccessHandler((s) => { clearTimeout(timer); resolve(JSON.parse(s)); })
        .withFailureHandler((e) => { clearTimeout(timer); reject(new TypeError((e && e.message) || String(e))); })
        .apiCall(JSON.stringify(payload));
    });
  }

  async function api(action, data = {}) {
    if (PRACTICE) return window.DemoBackend.call(action, data);
    const payload = Object.assign({}, data, { action, team: ls.get('team', '') });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const j = IN_GAS ? await gasCall(payload) : await (await fetch(CONFIG.backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      })).json();
      if (!j.ok) {
        const err = new Error(j.error || 'Something went wrong.');
        err.code = j.code;
        if (j.code === 'TEAM') askTeamCode();
        throw err;
      }
      return j;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The connection is slow. Please try again.');
      if (e instanceof TypeError) throw new Error("Can't reach the spreadsheet. Check the phone's internet connection.");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Title, author, year and cover — looked up straight from Google Books / Open Library (free, no key). */
  async function fetchMeta(p) {
    // Open Library first: it matches the exact ISBN, so you get the right edition.
    let ol = null;
    try {
      const r = await fetch('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN:' + p.isbn13);
      if (r.ok) {
        const d = (await r.json())['ISBN:' + p.isbn13];
        if (d && d.title) {
          ol = {
            title: d.title + (d.subtitle ? ': ' + d.subtitle : ''),
            author: (d.authors || []).map((a) => a.name).join(', '),
            year: ((d.publish_date || '').match(/\d{4}/) || [''])[0],
            publisher: ((d.publishers || [])[0] || {}).name || '',
            cover: (d.cover && (d.cover.medium || d.cover.small)) || '',
          };
          if (ol.cover && ol.author) return ol;
        }
      }
    } catch (e) { /* try Google Books */ }
    // Google Books fills gaps, but only if its result really has this ISBN (its search can return other editions).
    try {
      const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + p.isbn13);
      if (r.ok) {
        const j = await r.json();
        const hit = (j.items || []).find((it) => ((it.volumeInfo || {}).industryIdentifiers || [])
          .some((x) => x.identifier === p.isbn13 || x.identifier === p.isbn10));
        const v = hit && hit.volumeInfo;
        if (v && v.title) {
          const g = {
            title: v.title + (v.subtitle ? ': ' + v.subtitle : ''),
            author: (v.authors || []).join(', '),
            year: (v.publishedDate || '').slice(0, 4),
            publisher: v.publisher || '',
            cover: ((v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || '').replace('http:', 'https:'),
          };
          if (!ol) return g;
          return { title: ol.title, author: ol.author || g.author, year: ol.year || g.year, publisher: ol.publisher || g.publisher, cover: ol.cover || g.cover };
        }
      }
    } catch (e) { /* nothing more */ }
    return ol;
  }
  window.fetchMeta = fetchMeta;

  /* ---------------- Links to other sites ---------------- */
  function siteLinks(p, meta, cond) {
    const isbn = p && p.isbn13;
    const title = (meta && meta.title) || '';
    const author = (meta && meta.author) || '';
    const q = encodeURIComponent(isbn || [title, author].filter(Boolean).join(' '));
    const ebayCond = cond === 'new' ? '1000' : '2750%7C3000%7C4000%7C5000%7C6000';
    const out = [
      { key: 'ebaySold', label: '✅ eBay sold', hl: true, url: `https://www.ebay.com/sch/i.html?_nkw=${q}&_sacat=267&LH_Sold=1&LH_Complete=1&LH_ItemCondition=${ebayCond}` },
      { key: 'ebayNow', label: '🛒 eBay for sale', url: `https://www.ebay.com/sch/i.html?_nkw=${q}&_sacat=267&LH_ItemCondition=${ebayCond}` },
      {
        key: 'abe', label: '📚 AbeBooks', hl: true,
        url: isbn ? `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}&sortby=17`
          : `https://www.abebooks.com/servlet/SearchResults?tn=${encodeURIComponent(title)}&an=${encodeURIComponent(author)}&sortby=17`,
      },
      { key: 'amazon', label: '📦 Amazon', url: `https://www.amazon.com/s?k=${q}&i=stripbooks` },
    ];
    if (isbn) {
      out.push({ key: 'bookscouter', label: '💵 BookScouter', url: `https://bookscouter.com/book/${isbn}` });
      out.push({ key: 'bookfinder', label: '🔎 BookFinder', url: `https://www.bookfinder.com/isbn/${isbn}/` });
    }
    return out;
  }

  /* ---------------- Modal ---------------- */
  let modalClose = null;
  function showModal(html, onClose) {
    $('#modal').innerHTML = html;
    $('#modalBack').classList.remove('hidden');
    modalClose = onClose || null;
    const f = $('#modal [autofocus]') || $('#modal input, #modal button');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function hideModal() {
    $('#modalBack').classList.add('hidden');
    $('#modal').innerHTML = '';
    const fn = modalClose; modalClose = null;
    if (fn) fn();
  }
  const modalOpen = () => !$('#modalBack').classList.contains('hidden');
  $('#modalBack').addEventListener('click', (e) => { if (e.target.id === 'modalBack') hideModal(); });

  /** Simple yes/no/cancel chooser. Resolves to the chosen value, or null if dismissed. */
  function choose(title, text, buttons) {
    return new Promise((resolve) => {
      let done = false;
      showModal(`<h2>${esc(title)}</h2><p>${text}</p><div class="stack">${buttons.map((b, i) =>
        `<button class="btn wide ${b.cls || ''}" data-i="${i}" type="button">${esc(b.label)}</button>`).join('')}</div>`,
      () => { if (!done) resolve(null); });
      $$('#modal [data-i]').forEach((el) => el.addEventListener('click', () => {
        done = true; hideModal(); resolve(buttons[+el.dataset.i].value);
      }));
    });
  }

  /* ---------------- Who's scanning / team code ---------------- */
  function pickName() {
    return new Promise((resolve) => {
      const names = String(S.settings.volunteers || '').split(/\n|,/).map((x) => x.trim()).filter(Boolean);
      showModal(`<h2>Who's scanning today?</h2><p>Your name goes next to the books you add.</p>
        <div class="stack">${names.map((n) => `<button class="btn wide" type="button" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
        <label class="row-label" for="otherName" style="margin-top:6px">${names.length ? 'Someone else:' : 'Your name:'}</label>
        <input id="otherName" class="text-input" placeholder="Type your name" value="${esc(names.includes(S.who) ? '' : S.who)}" autocomplete="given-name">
        <button id="nameOk" class="btn primary wide" type="button">OK</button></div>`, () => resolve(S.who));
      const setName = (n) => {
        S.who = n.trim() || 'Volunteer';
        ls.set('who', S.who);
        $('#whoName').textContent = S.who;
        hideModal();
      };
      $$('#modal [data-name]').forEach((b) => b.addEventListener('click', () => setName(b.dataset.name)));
      $('#nameOk').addEventListener('click', () => setName($('#otherName').value));
      $('#otherName').addEventListener('keydown', (e) => { if (e.key === 'Enter') setName($('#otherName').value); });
    });
  }

  let askingTeam = false;
  function askTeamCode() {
    if (askingTeam) return;
    askingTeam = true;
    showModal(`<h2>Enter the team code</h2><p>Ask the book sale organizer for the team code. You only need to do this once on this phone or computer.</p>
      <div class="stack"><input id="teamIn" class="text-input" autocomplete="off" autocapitalize="off" placeholder="Team code" autofocus>
      <button id="teamOk" class="btn primary wide" type="button">Save</button></div>`, () => { askingTeam = false; });
    const save = () => {
      ls.set('team', $('#teamIn').value.trim());
      hideModal();
      hello().then(() => toast('Connected ✓'));
    };
    $('#teamOk').addEventListener('click', save);
    $('#teamIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  }

  /* ---------------- Settings from the sheet ---------------- */
  function applySettings(s) {
    S.settings = Object.assign({}, window.DEFAULT_SETTINGS, s);
    ls.set('settings', S.settings);
    $('#appName').textContent = '📚 ' + S.settings.appName;
    document.title = S.settings.appName;
  }

  async function hello() {
    try {
      const r = await api('hello');
      applySettings(r.settings);
      S.ebayReady = r.ebayReady; S.keepaReady = r.keepaReady;
      return true;
    } catch (e) {
      if (e.code !== 'TEAM') setMsg(esc(e.message), 'err');
      return false;
    }
  }

  /* ---------------- Mode + condition ---------------- */
  function setMode(m) {
    S.mode = m;
    ls.set('mode', m);
    $$('.mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $('#modeHelp').innerHTML = MODE_HELP[m];
    $('#condWrap').classList.toggle('hidden', m === 'sold');
    $('#rapidPanel').classList.toggle('hidden', m !== 'rapid');
    S.current = null;
    $('#result').classList.add('hidden');
    $('#result').innerHTML = '';
    setMsg('');
    if (m === 'rapid') renderRapid();
    if ((m === 'rapid' || m === 'detailed' || m === 'sold') && !S.who) pickName();
    focusInput();
  }

  function setCond(c) {
    S.cond = c;
    ls.set('cond', c);
    $$('[data-cond]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cond === c)));
    if (S.current && S.current.kind === 'book') openBook({ p: S.current.p, meta: S.current.meta, skipBeep: true });
  }

  function focusInput() {
    if (isFinePointer && !modalOpen()) $('#isbnInput').focus();
  }

  /* ---------------- Entry: what happens when an ISBN comes in ---------------- */
  async function handleCode(raw) {
    if (!$('#settingsView').classList.contains('hidden')) return;
    const p = ISBN.parse(raw);
    if (!p.ok) {
      beep(false);
      setMsg(esc(p.message), 'err');
      return false;
    }
    setMsg('');
    $('#isbnInput').value = '';
    await dispatch({ p });
    return true;
  }

  async function dispatch({ p, meta }) {
    if (S.mode === 'rapid') return rapidAdd({ p, meta });
    if (S.mode === 'sold') return soldOpen({ p, meta });
    if (S.mode === 'detailed' && S.current && S.current.kind === 'book' && S.current.dirty && !S.current.saved) {
      const t = (S.current.meta && S.current.meta.title) || 'the last book';
      const pick = await choose('Save the last book first?', `You haven't saved <b>${esc(t)}</b> yet.`, [
        { label: '✅ Save it, then go on', value: 'save', cls: 'go' },
        { label: "Don't save it", value: 'skip' },
        { label: 'Go back', value: null },
      ]);
      if (!pick) return;
      if (pick === 'save') { const ok = await saveCurrent(); if (!ok) return; }
    }
    return openBook({ p, meta });
  }

  /* ---------------- Quick Check + One at a Time ---------------- */
  function newForm() {
    return { copies: 1, format: '', condition: 'Good', first: false, signed: false, where: '', final: '', box: ls.get('lastBox', ''), notes: '', dupChoice: 'addCopy' };
  }

  async function openBook({ p, meta, skipBeep }) {
    if (!skipBeep) beep(true);
    const cur = {
      kind: 'book', p: p || null, meta: meta || null, metaDone: !!meta || !p, look: null, lookErr: '',
      yourEst: '', form: newForm(), dirty: false, saved: null, saving: false,
    };
    S.current = cur;
    renderBook();
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!meta && p) {
      fetchMeta(p).then((m) => {
        if (S.current !== cur) return;
        cur.meta = m; cur.metaDone = true; renderBook(true);
      });
    }
    try {
      const look = await api('lookup', {
        isbn: p ? p.isbn13 : '', title: meta && meta.title, author: meta && meta.author, condition: S.cond,
      });
      if (S.current !== cur) return;
      cur.look = look;
    } catch (e) {
      if (S.current !== cur) return;
      cur.lookErr = e.message;
    }
    renderBook(true);
  }

  /** The number that drives the color: your estimate if typed, else the system's. */
  function valueInfo(cur) {
    const mine = num(cur.yourEst);
    const est = cur.look && cur.look.estimate;
    if (mine != null) return { value: mine, mine: true, basis: `Your estimate (${S.who || 'you'})`, lowData: false };
    if (est) return { value: est.value, mine: false, basis: est.basis, lowData: est.lowData };
    return null;
  }

  function verdictHtml(cur) {
    const s = S.settings;
    if (!cur.look && !cur.lookErr && num(cur.yourEst) == null) {
      return `<div class="verdict none"><div class="loading"><span class="spinner"></span> Checking prices…</div></div>`;
    }
    const vi = valueInfo(cur) || { value: null, basis: cur.lookErr ? 'Price lookup failed: ' + cur.lookErr : 'No price data found', lowData: true };
    const t = Logic.tier(vi.value, s);
    const noSource = cur.look && cur.look.ebay && cur.look.ebay.notConfigured && !(cur.look.keepa && cur.look.keepa.found);
    let why = esc(vi.basis);
    if (vi.value == null && noSource) why = 'eBay isn’t connected yet — use the links below to check prices.';
    const low = vi.value != null && vi.lowData && !vi.mine;
    return `<div class="verdict ${t.key}">
      <div class="dot ${low ? 'low' : ''}" aria-hidden="true">${vi.value != null ? (vi.value >= 10 ? '$' + Math.round(vi.value) : money(vi.value)) : '?'}${vi.value != null ? '<small>value</small>' : ''}</div>
      <div><div class="lvl">${esc(t.name)}</div><div class="why">${why}</div>
      ${low ? '<div class="lowtxt">⚠️ Not much data — check the links below.</div>' : ''}
      ${vi.value == null ? '<div class="lowtxt">Type your own estimate below if you know it.</div>' : ''}</div></div>`;
  }

  function suggestHtml(cur) {
    const s = S.settings;
    const vi = valueInfo(cur);
    const v = vi ? vi.value : null;
    if (S.mode === 'detailed' && cur.form.format) {
      return `<div class="suggest">Suggested sale price: <b>${money(Logic.suggestedPrice(v, cur.form.format, s))}</b></div>`;
    }
    if (v == null || v < s.tier2Min) {
      return `<div class="suggest">Suggested sale price: <b>${money(s.pricePaperback)}</b> paperback · <b>${money(s.priceHardcover)}</b> hardcover</div>`;
    }
    const where = Logic.whereToSell(v, s);
    return `<div class="suggest">Suggested sale price: <b>${money(Logic.suggestedPrice(v, '', s))}</b>${where === 'Online' ? ' · <b>consider selling online</b>' : ''}</div>`;
  }

  function bookHeaderHtml(p, meta, metaDone) {
    const isbn = p ? p.isbn13 : '';
    let cover = '<div class="cover">📖</div>';
    const src = (meta && meta.cover) || (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : '');
    if (src) cover = `<img class="cover" src="${esc(src)}" alt="" onerror="this.outerHTML='<div class=&quot;cover&quot;>📖</div>'">`;
    let title;
    if (meta && meta.title) title = `<h2>${esc(meta.title)}</h2>${meta.author ? `<div class="by">${esc(meta.author)}</div>` : ''}`;
    else if (!metaDone) title = `<div class="loading"><span class="spinner"></span> Finding the title…</div>`;
    else title = `<h2>Title not found</h2><div class="by muted">The price links below still work.</div>`;
    const bits = [meta && meta.year, meta && meta.publisher, isbn && 'ISBN ' + isbn].filter(Boolean).map(esc).join(' · ');
    return `<div class="book">${cover}<div>${title}<div class="meta">${bits}</div></div></div>`;
  }

  /** keepFocus: data arrived in the background — don't kick the person out of the box they're typing in. */
  function renderBook(keepFocus = false) {
    const cur = S.current;
    if (!cur || cur.kind !== 'book') return;
    const s = S.settings;
    const look = cur.look || {};
    const ebay = look.ebay;
    const keepa = look.keepa;
    const dup = look.dup;
    const detailed = S.mode === 'detailed';
    const html = [];

    html.push(`<div class="card">${bookHeaderHtml(cur.p, cur.meta, cur.metaDone)}`);

    if (dup && !cur.saved) {
      const where = dup.box ? ` · Box ${esc(dup.box)}` : '';
      if (detailed) {
        html.push(`<div class="dup"><b>📋 Already on the list (${esc(dup.copies)} ${dup.copies == 1 ? 'copy' : 'copies'}${where})</b>
          <div class="choices" data-group="dupChoice">
            <button type="button" data-v="addCopy" aria-pressed="${cur.form.dupChoice === 'addCopy'}">Add to that entry</button>
            <button type="button" data-v="new" aria-pressed="${cur.form.dupChoice === 'new'}">Save as separate entry</button>
          </div></div>`);
      } else {
        html.push(`<div class="dup"><b>📋 Already on the list — ${esc(dup.copies)} ${dup.copies == 1 ? 'copy' : 'copies'}${where}</b>
          ${dup.final != null ? `Priced at ${money(dup.final)}.` : ''}</div>`);
      }
    }

    html.push(`<div id="verdictSlot">${verdictHtml(cur)}</div><div id="suggestSlot">${suggestHtml(cur)}</div>`);

    html.push(`<div class="est-box"><label for="yourEst">Your price estimate <span class="muted">(optional)</span></label>
      <div class="money"><span class="cur">$</span><input id="yourEst" data-f="yourEst" class="big-input" inputmode="decimal" placeholder="0.00" value="${esc(cur.yourEst)}" autocomplete="off"></div>
      <div class="est-note" id="estNote">${num(cur.yourEst) != null
        ? `Using your number. <button type="button" class="linkish" data-act="clearEst">Use the system's number instead</button>`
        : 'If you know better, type what you think it’s worth. Your number replaces the system’s guess.'}</div></div>`);
    html.push('</div>');

    // Links out
    html.push(`<div class="card"><h2>Check prices yourself</h2><div class="links">${siteLinks(cur.p, cur.meta, S.cond).map((l) =>
      `<a class="btn ${l.hl ? 'hl' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>
      <p class="muted" style="margin:10px 0 0">“eBay sold” shows what buyers actually paid (about the last 3 months).</p></div>`);

    // eBay current listings
    if (ebay && !ebay.notConfigured) {
      html.push('<div class="card"><h2>On eBay right now <span class="muted">(asking prices, not sold prices)</span></h2>');
      if (ebay.error) {
        html.push(`<p class="msg err">Couldn't get eBay listings: ${esc(ebay.error)}</p>`);
      } else if (!ebay.used) {
        html.push('<p class="muted" style="margin:0">No copies listed for sale on eBay right now.</p>');
      } else {
        html.push(`<div class="stats"><div><b>${ebay.used}</b><span>for sale</span></div><div><b>${money(ebay.low)}</b><span>lowest</span></div>
          <div><b>${money(ebay.median)}</b><span>middle</span></div><div><b>${money(ebay.high)}</b><span>highest</span></div></div>
          <div class="listings" style="margin-top:12px">${ebay.items.map((it) => {
            const img = it.img || (cur.meta && cur.meta.cover) || '';
            const ttl = it.title || ((cur.meta && cur.meta.title) || 'Listing') + ' — ' + it.cond;
            return `<a class="listing" href="${esc(it.url)}" target="_blank" rel="noopener">
              ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<div class="noimg">📖</div>'}
              <div class="t">${esc(ttl)}</div>
              <div class="p">${money(it.price)} <small>${it.ship ? '+ ' + money(it.ship) + ' ship' : it.ship === 0 ? 'free ship' : ''}${it.auction ? ' · auction' : ''}</small></div></a>`;
          }).join('')}</div>
          <p class="muted" style="margin:4px 0 0">Swipe sideways to see more. Tap one to open it on eBay.</p>`);
      }
      html.push('</div>');
    }

    // Keepa (optional, paid)
    if (keepa && keepa.found) {
      const rank = keepa.salesRank;
      const pace = rank == null ? '' : rank < 100000 ? 'sells often' : rank < 1000000 ? 'sells now and then' : 'sells rarely';
      html.push(`<div class="card"><h2>Amazon (from Keepa)</h2><div class="stats">
        <div><b>${money(keepa.usedNow)}</b><span>used now</span></div><div><b>${money(keepa.usedAvg90)}</b><span>used, 90-day avg</span></div>
        <div><b>${money(keepa.newNow)}</b><span>new now</span></div><div><b>${rank ? rank.toLocaleString() : '—'}</b><span>sales rank${pace ? ' · ' + pace : ''}</span></div></div></div>`);
    } else if (keepa && keepa.error) {
      html.push(`<div class="card"><p class="msg err" style="margin:0">Keepa lookup failed: ${esc(keepa.error)}</p></div>`);
    }

    // One at a Time: details form
    if (detailed && !cur.saved) {
      const f = cur.form;
      const where = f.where || Logic.whereToSell(valueInfo(cur) && valueInfo(cur).value, s);
      html.push(`<div class="card"><h2>Details for the list</h2>
        <div class="field"><span class="label">How many copies?</span><div class="stepper">
          <button type="button" data-act="copies-" aria-label="One fewer">−</button>
          <input data-f="copies" inputmode="numeric" value="${esc(f.copies)}" aria-label="Copies">
          <button type="button" data-act="copies+" aria-label="One more">+</button></div></div>
        <div class="field"><span class="label">Format</span><div class="choices" data-group="format">
          ${['Paperback', 'Hardcover', 'Mass market', 'Other'].map((x) => `<button type="button" data-v="${x}" aria-pressed="${f.format === x}">${x}</button>`).join('')}</div></div>
        <div class="field"><span class="label">Condition</span><div class="choices" data-group="condition">
          ${['Like new', 'Good', 'Fair', 'Poor'].map((x) => `<button type="button" data-v="${x}" aria-pressed="${f.condition === x}">${x}</button>`).join('')}</div></div>
        <div class="field"><span class="label">Special?</span><div class="choices">
          <button type="button" data-toggle="first" aria-pressed="${f.first}">First edition</button>
          <button type="button" data-toggle="signed" aria-pressed="${f.signed}">Signed</button></div></div>
        ${s.whereOn ? `<div class="field"><span class="label">Where to sell</span><div class="choices" data-group="where">
          ${['Book sale', 'Online'].map((x) => `<button type="button" data-v="${x}" aria-pressed="${where === x}">${x}${!f.where && where === x ? ' (suggested)' : ''}</button>`).join('')}</div></div>` : ''}
        <div class="field"><label for="finalIn">Price to put on it <span class="muted">(optional)</span></label>
          <div class="money"><span class="cur">$</span><input id="finalIn" data-f="final" class="big-input" inputmode="decimal" placeholder="${esc(Logic.suggestedPrice(valueInfo(cur) && valueInfo(cur).value, f.format, s))}" value="${esc(f.final)}"></div></div>
        <div class="field"><label for="boxIn">Box or shelf <span class="muted">(optional)</span></label>
          <input id="boxIn" data-f="box" class="text-input" value="${esc(f.box)}" placeholder="e.g. Box 12"></div>
        <div class="field"><label for="notesIn">Notes <span class="muted">(optional)</span></label>
          <textarea id="notesIn" data-f="notes" class="text-input" placeholder="Anything worth remembering">${esc(f.notes)}</textarea></div>
        <div class="actions"><button type="button" class="btn" data-act="skip">Skip</button>
          <button type="button" class="btn go" data-act="save" ${cur.saving ? 'disabled' : ''}>${cur.saving ? 'Saving…' : '✅ Save to list'}</button></div></div>`);
    } else if (detailed && cur.saved) {
      html.push(`<div class="card"><p class="msg ok" style="font-size:1.1rem;margin:0 0 12px">✅ ${cur.saved.action === 'addedCopy'
        ? `Added to the existing entry — now ${esc(cur.saved.copies)} copies.` : `Saved to the list as ${esc(cur.saved.id)}.`}</p>
        <button type="button" class="btn primary wide" data-act="next">Next book</button></div>`);
    } else {
      html.push(`<div class="actions" style="margin:14px 0 0;padding:0;background:none;position:static"><button type="button" class="btn primary wide" data-act="next">Next book</button></div>`);
    }

    // Re-render without losing the place the person is typing.
    const active = document.activeElement;
    const activeF = keepFocus && active && active.dataset && active.dataset.f;
    const selStart = active && active.selectionStart;
    const r = $('#result');
    r.innerHTML = html.join('');
    r.classList.remove('hidden');
    if (activeF) {
      const el = $(`[data-f="${activeF}"]`, r);
      if (el) { el.focus(); try { el.setSelectionRange(selStart, selStart); } catch (e) { /* not a text box */ } }
    }
  }

  /** Light update while typing (no full re-render). */
  function refreshVerdict() {
    const cur = S.current;
    if (!cur || cur.kind !== 'book') return;
    $('#verdictSlot').innerHTML = verdictHtml(cur);
    $('#suggestSlot').innerHTML = suggestHtml(cur);
    const note = $('#estNote');
    if (note) {
      note.innerHTML = num(cur.yourEst) != null
        ? `Using your number. <button type="button" class="linkish" data-act="clearEst">Use the system's number instead</button>`
        : 'If you know better, type what you think it’s worth. Your number replaces the system’s guess.';
    }
  }

  async function saveCurrent() {
    const cur = S.current;
    if (!cur || cur.kind !== 'book' || cur.saving) return false;
    if (!S.who) await pickName();
    const f = cur.form;
    const look = cur.look || {};
    const e = look.ebay && !look.ebay.error && !look.ebay.notConfigured ? look.ebay : {};
    const k = look.keepa && look.keepa.found ? look.keepa : {};
    const est = look.estimate || {};
    const m = cur.meta || {};
    const autoWhere = Logic.whereToSell(valueInfo(cur) && valueInfo(cur).value, S.settings);
    const book = {
      isbn13: cur.p ? cur.p.isbn13 : '', title: m.title || '', author: m.author || '', year: m.year || '', publisher: m.publisher || '',
      coverUrl: m.cover || '', format: f.format, condition: f.condition,
      special: [f.first && 'First edition', f.signed && 'Signed'].filter(Boolean).join(', '),
      copies: Math.max(1, parseInt(f.copies, 10) || 1), searched: S.cond,
      ebayCount: e.used, ebayLow: e.low, ebayMedian: e.median,
      amzUsed: k.usedAvg90 || k.usedNow || '', amzRank: k.salesRank || '',
      sysEst: est.value, basis: est.basis ? est.basis + (est.lowData && est.value != null ? ' (not much data)' : '') : '',
      yourEst: num(cur.yourEst) != null ? num(cur.yourEst) : '', yourEstBy: S.who,
      final: num(f.final) != null ? num(f.final) : '',
      where: f.where && f.where !== autoWhere ? f.where : '',
      box: f.box.trim(), notes: f.notes.trim(), by: S.who, mode: 'One at a Time',
    };
    const dupId = look.dup && f.dupChoice === 'addCopy' ? look.dup.id : null;
    cur.saving = true; renderBook();
    try {
      const r = await api('save', { book, dupId });
      cur.saved = r;
      ls.set('lastBox', book.box);
      beep(true);
      toast(r.action === 'addedCopy' ? `Added — now ${r.copies} copies` : `Saved ✓ (${r.id})`);
      return true;
    } catch (err) {
      beep(false);
      toast('Not saved: ' + err.message, 5000);
      return false;
    } finally {
      cur.saving = false;
      if (S.current === cur) renderBook();
    }
  }

  function nextBook() {
    S.current = null;
    $('#result').classList.add('hidden');
    $('#result').innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMsg('Ready for the next book.', 'ok');
    focusInput();
  }

  // Taps and typing inside the result card.
  $('#result').addEventListener('click', async (e) => {
    const cur = S.current;
    if (!cur) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const group = btn.parentElement && btn.parentElement.dataset.group;
    if (cur.kind === 'sold') return soldClick(btn, act);
    if (group) { cur.form[group] = btn.dataset.v; cur.dirty = true; renderBook(); return; }
    if (btn.dataset.toggle) { cur.form[btn.dataset.toggle] = !cur.form[btn.dataset.toggle]; cur.dirty = true; renderBook(); return; }
    if (act === 'copies-' || act === 'copies+') {
      cur.form.copies = Math.max(1, (parseInt(cur.form.copies, 10) || 1) + (act === 'copies+' ? 1 : -1));
      cur.dirty = true; renderBook(); return;
    }
    if (act === 'clearEst') { cur.yourEst = ''; const i = $('#yourEst'); if (i) i.value = ''; refreshVerdict(); return; }
    if (act === 'save') { await saveCurrent(); return; }
    if (act === 'skip' || act === 'next') nextBook();
  });

  $('#result').addEventListener('input', (e) => {
    const cur = S.current;
    const f = e.target.dataset.f;
    if (!cur || !f) return;
    if (cur.kind === 'sold') { cur[f] = e.target.value; return; }
    if (f === 'yourEst') { cur.yourEst = e.target.value.replace(/[^0-9.]/g, ''); cur.dirty = true; refreshVerdict(); return; }
    cur.form[f] = e.target.value;
    cur.dirty = true;
    if (f === 'final' || f === 'copies') return;
  });

  /* ---------------- Rapid Scan ---------------- */
  let lastRapid = { key: '', at: 0 };

  function rapidAdd({ p, meta }) {
    const key = p ? p.isbn13 : 't:' + (meta && meta.title);
    // Ignore the same barcode read twice in a row by accident.
    if (key === lastRapid.key && Date.now() - lastRapid.at < 3000) return;
    lastRapid = { key, at: Date.now() };
    if (!S.who) { pickName(); }
    beep(true);
    const item = { n: S.rapid.length + 1, p, meta: meta || null, status: 'wait', title: (meta && meta.title) || '', res: null, err: '' };
    S.rapid.unshift(item);
    S.queue.push(item);
    renderRapid();
    pumpQueue();
    return item;
  }

  function pumpQueue() {
    while (S.running < 2 && S.queue.length) {
      const item = S.queue.shift();
      S.running++;
      api('rapidSave', {
        isbn: item.p ? item.p.isbn13 : '', title: item.meta && item.meta.title, author: item.meta && item.meta.author,
        condition: S.cond, by: S.who,
      }).then((r) => {
        item.res = r;
        item.title = r.title || item.title;
        item.status = r.pending ? 'pending' : r.dup ? 'dup' : 'done';
      }).catch((e) => {
        item.status = 'err'; item.err = e.message;
      }).finally(() => {
        S.running--;
        renderRapid();
        pumpQueue();
      });
    }
  }

  function renderRapid() {
    const panel = $('#rapidPanel');
    if (S.mode !== 'rapid') return;
    const waiting = S.rapid.filter((x) => x.status === 'wait').length;
    const failed = S.rapid.filter((x) => x.status === 'err');
    const s = S.settings;
    panel.innerHTML = `<div class="ready"><span class="pulse"></span> Ready — scan the next book</div>
      <div class="card"><h2>Scanned this session: ${S.rapid.length}${waiting ? ` <span class="muted">· ${waiting} still looking up</span>` : ''}</h2>
      ${failed.length ? `<p class="msg err">${failed.length} didn't save. <button type="button" class="btn small" data-act="retry">Try again</button></p>` : ''}
      ${S.rapid.length ? `<ul class="scanlist">${S.rapid.map((x) => {
        const r = x.res || {};
        const t = x.status === 'wait' ? { key: 'wait' } : Logic.tier(r.value, s);
        const label = x.title || (x.p ? 'ISBN ' + x.p.isbn13 : 'Book');
        let sub = x.p ? x.p.isbn13 : 'No ISBN';
        if (x.status === 'wait') sub += ' · looking up…';
        if (x.status === 'pending') sub += ' · saved, price will fill in later';
        if (x.status === 'err') sub += ' · ❌ not saved: ' + x.err;
        if (r.id) sub += ' · ' + r.id;
        const tag = x.status === 'dup' ? `<span class="tag">already on list · now ${esc(r.copies)} copies</span>`
          : r.dup ? '<span class="tag">duplicate — new row</span>' : '';
        return `<li><span class="mini-dot ${t.key}"></span><div class="t"><b>${esc(label)}</b><span>${esc(sub)}</span>${tag}</div>
          <div class="v">${x.status === 'wait' ? '' : r.value != null ? money(r.value) : '<span class="muted">no price</span>'}</div></li>`;
      }).join('')}</ul>` : '<p class="muted" style="margin:0">Scan a barcode, type an ISBN, or tap “Scan barcode with camera”. The camera stays on in this mode.</p>'}
      </div>`;
  }

  $('#rapidPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="retry"]');
    if (!b) return;
    S.rapid.filter((x) => x.status === 'err').forEach((x) => { x.status = 'wait'; x.err = ''; S.queue.push(x); });
    renderRapid();
    pumpQueue();
  });

  window.addEventListener('beforeunload', (e) => {
    if (S.queue.length || S.running) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- Mark Sold ---------------- */
  async function soldOpen({ p, meta }) {
    beep(true);
    const cur = { kind: 'sold', p: p || null, meta: meta || null, metaDone: !!meta || !p, book: undefined, price: '', qty: 1, saving: false, err: '' };
    S.current = cur;
    renderSold();
    if (!meta && p) fetchMeta(p).then((m) => { if (S.current === cur) { cur.meta = m; cur.metaDone = true; renderSold(); } });
    try {
      const r = await api('findBook', { isbn: p ? p.isbn13 : '', title: meta && meta.title, author: meta && meta.author });
      if (S.current !== cur) return;
      cur.book = r.book;
      if (r.book && cur.price === '') {
        const pr = r.book.final != null ? r.book.final : r.book.suggested;
        cur.price = pr != null ? Number(pr).toFixed(2) : '';
      }
    } catch (e) {
      if (S.current !== cur) return;
      cur.book = null; cur.err = e.message;
    }
    renderSold();
  }

  function renderSold() {
    const cur = S.current;
    if (!cur || cur.kind !== 'sold') return;
    const b = cur.book;
    const meta = cur.meta || (b ? { title: b.title, author: b.author } : null);
    let status;
    if (b === undefined) status = '<div class="loading"><span class="spinner"></span> Looking for it on the list…</div>';
    else if (b) {
      const t = Logic.tier(b.value, S.settings);
      status = `<div class="dup" style="background:#f4f8fc;border-color:#c9d8ea"><b><span class="mini-dot ${t.key}"></span> On the list as ${esc(b.id)}</b>
        ${esc(b.copies)} ${b.copies == 1 ? 'copy' : 'copies'}, ${esc(b.sold || 0)} sold so far.
        ${b.final != null ? `Price on it: <b>${money(b.final)}</b>` : `Suggested price: <b>${money(b.suggested)}</b>`}</div>`;
    } else status = `<div class="dup"><b>Not on the list</b>That's fine — you can still record the sale.${cur.err ? `<br><span class="msg err">${esc(cur.err)}</span>` : ''}</div>`;
    $('#result').innerHTML = `<div class="card">${bookHeaderHtml(cur.p, meta, cur.metaDone || !!b)}${status}
      <div class="field"><label for="soldPrice">Sold for</label>
        <div class="money"><span class="cur">$</span><input id="soldPrice" data-f="price" class="big-input" inputmode="decimal" value="${esc(cur.price)}" placeholder="0.00"></div></div>
      <div class="field"><span class="label">How many?</span><div class="stepper">
        <button type="button" data-act="qty-" aria-label="One fewer">−</button>
        <input data-f="qty" inputmode="numeric" value="${esc(cur.qty)}" aria-label="How many">
        <button type="button" data-act="qty+" aria-label="One more">+</button></div></div>
      <div class="actions" style="position:static;background:none;margin:18px 0 0;padding:0">
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="button" class="btn go" data-act="record" ${cur.saving ? 'disabled' : ''}>${cur.saving ? 'Saving…' : '✅ Record sale'}</button></div></div>`;
    $('#result').classList.remove('hidden');
  }

  async function soldClick(btn, act) {
    const cur = S.current;
    if (act === 'qty-' || act === 'qty+') {
      cur.qty = Math.max(1, (parseInt(cur.qty, 10) || 1) + (act === 'qty+' ? 1 : -1));
      renderSold(); return;
    }
    if (act === 'cancel') return nextBook();
    if (act === 'record' && !cur.saving) {
      if (!S.who) await pickName();
      cur.saving = true; renderSold();
      try {
        const b = cur.book || {};
        await api('markSold', {
          id: b.id || '', isbn: cur.p ? cur.p.isbn13 : '', title: (cur.meta && cur.meta.title) || b.title || '',
          price: num(cur.price) != null ? num(cur.price) : '', qty: parseInt(cur.qty, 10) || 1, by: S.who,
        });
        beep(true);
        toast('Sale recorded ✓');
        nextBook();
      } catch (e) {
        cur.saving = false; renderSold();
        toast('Not recorded: ' + e.message, 5000);
      }
    }
  }

  /* ---------------- Camera barcode scanning ---------------- */
  const SCAN_LIB = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  let lastCam = { code: '', at: 0 };

  function scanFormats() {
    const F = window.Html5QrcodeSupportedFormats;
    return [F.EAN_13, F.UPC_A, F.EAN_8];
  }

  async function openCamera() {
    const rapid = S.mode === 'rapid';
    showModal(`<h2>Point the camera at the barcode</h2>
      <p>Hold the book steady, a hand's width from the camera.${rapid ? ' The camera stays on — scan one book after another.' : ''}</p>
      <div class="cam-box"><div id="camReader"></div><div id="camFlash" class="cam-flash hidden"></div></div>
      <div class="stack" style="margin-top:12px"><button id="camDone" class="btn primary wide" type="button">${rapid ? 'Done scanning' : 'Cancel'}</button></div>`,
    stopCamera);
    $('#camDone').addEventListener('click', hideModal);
    try {
      await loadScript(SCAN_LIB);
      const scanner = new window.Html5Qrcode('camReader', {
        formatsToSupport: scanFormats(), verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      S.cam = scanner;
      await scanner.start({ facingMode: 'environment' }, {
        fps: 10,
        qrbox: (w, h) => ({ width: Math.max(50, Math.floor(w * 0.85)), height: Math.max(50, Math.floor(Math.min(h * 0.45, w * 0.45))) }),
      }, onCamCode, () => {});
    } catch (e) {
      // Live camera blocked (common when the page is served by Apps Script). Use the phone's camera app instead.
      S.liveCamFailed = true;
      S.cam = null;
      if (!modalOpen()) return;
      showModal(`<h2>Take a photo of the barcode</h2>
        <p>This phone won't let the page use the camera directly, so take a quick photo instead. The page reads the barcode from the photo.</p>
        <div class="stack"><button id="camPhoto" class="btn primary wide" type="button">📷 Take a photo</button>
        <button id="camType" class="btn wide" type="button">Type the ISBN instead</button></div>`);
      $('#camPhoto').addEventListener('click', () => { hideModal(); $('#photoInput').click(); });
      $('#camType').addEventListener('click', () => { hideModal(); $('#isbnInput').focus(); });
    }
  }

  function camFlash(text, ok) {
    const f = $('#camFlash');
    if (!f) return;
    f.textContent = text;
    f.style.background = ok ? 'rgba(21,128,61,.92)' : 'rgba(185,28,28,.92)';
    f.classList.remove('hidden');
    clearTimeout(camFlash.t);
    camFlash.t = setTimeout(() => f.classList.add('hidden'), 2200);
  }

  async function onCamCode(text) {
    if (text === lastCam.code && Date.now() - lastCam.at < 2500) return;
    lastCam = { code: text, at: Date.now() };
    const p = ISBN.parse(text);
    if (!p.ok) { beep(false); camFlash(p.reason === 'notbook' || p.reason === 'upc' ? 'That’s a store barcode, not the ISBN.' : p.message, false); return; }
    if (S.mode === 'rapid') {
      rapidAdd({ p });
      camFlash('✓ Scanned ' + p.isbn13 + ' — next book', true);
      return;
    }
    hideModal();
    await dispatch({ p });
  }

  function stopCamera() {
    const sc = S.cam;
    S.cam = null;
    if (sc) sc.stop().then(() => sc.clear()).catch(() => {});
    focusInput();
  }

  /* ---------------- Photo of the ISBN ---------------- */
  const OCR_LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  async function readPhoto(file) {
    showModal(`<h2>Reading your photo…</h2><p class="loading"><span class="spinner"></span> Looking for a barcode or ISBN numbers. The first time can take 10–20 seconds.</p>
      <div id="photoScratch" style="display:none"></div>`);
    let found = [];
    try {
      await loadScript(SCAN_LIB);
      const h = new window.Html5Qrcode('photoScratch', { formatsToSupport: scanFormats(), verbose: false });
      const code = await h.scanFile(file, false);
      const p = ISBN.parse(code);
      if (p.ok) found = [p];
    } catch (e) { /* no barcode in the photo — read the printed numbers instead */ }
    if (!found.length) {
      try {
        await loadScript(OCR_LIB);
        const res = await window.Tesseract.recognize(file, 'eng');
        found = ISBN.findInText((res && res.data && res.data.text) || '');
      } catch (e) {
        found = [];
      }
    }
    if (!modalOpen()) return;
    if (found.length === 1) { hideModal(); return dispatch({ p: found[0] }); }
    if (found.length > 1) {
      showModal(`<h2>Which ISBN is it?</h2><p>The photo had more than one.</p><div class="stack">${found.map((p, i) =>
        `<button class="btn wide" data-i="${i}" type="button">${esc(p.isbn13)}</button>`).join('')}</div>`);
      $$('#modal [data-i]').forEach((b) => b.addEventListener('click', () => { hideModal(); dispatch({ p: found[+b.dataset.i] }); }));
      return;
    }
    showModal(`<h2>Couldn't find an ISBN</h2><p>Try another photo: get close to the ISBN or barcode, in good light, and hold steady. Or type the numbers in.</p>
      <div class="stack"><button class="btn primary wide" id="photoAgain" type="button">📷 Take another photo</button>
      <button class="btn wide" id="photoClose" type="button">Type it instead</button></div>`);
    $('#photoAgain').addEventListener('click', () => { hideModal(); $('#photoInput').click(); });
    $('#photoClose').addEventListener('click', () => { hideModal(); $('#isbnInput').focus(); });
  }

  /* ---------------- No ISBN: search by title ---------------- */
  function openTitleSearch() {
    showModal(`<h2>Search by title</h2><p>For books without an ISBN (most books printed before about 1970).</p>
      <div class="stack">
        <label class="row-label" for="tsTitle">Title</label><input id="tsTitle" class="text-input" autofocus>
        <label class="row-label" for="tsAuthor">Author <span class="muted">(optional)</span></label><input id="tsAuthor" class="text-input">
        <button id="tsGo" class="btn primary wide" type="button">Search</button>
        <div id="tsResults"></div></div>`);
    const go = async () => {
      const title = $('#tsTitle').value.trim();
      const author = $('#tsAuthor').value.trim();
      if (!title) { $('#tsTitle').focus(); return; }
      const out = $('#tsResults');
      out.innerHTML = '<p class="loading"><span class="spinner"></span> Searching…</p>';
      // Open Library (free, no key). Results are "works", not a specific printing, so we price by title + author.
      let items = [];
      try {
        const url = 'https://openlibrary.org/search.json?limit=12&fields=title,subtitle,author_name,first_publish_year,cover_i'
          + '&title=' + encodeURIComponent(title) + (author ? '&author=' + encodeURIComponent(author) : '');
        const j = await (await fetch(url)).json();
        items = (j.docs || []).map((d) => ({
          p: null,
          meta: {
            title: d.title + (d.subtitle ? ': ' + d.subtitle : ''), author: (d.author_name || []).slice(0, 2).join(', '),
            year: d.first_publish_year ? String(d.first_publish_year) : '', publisher: '',
            cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
          },
        }));
      } catch (e) { /* show the "use what I typed" option */ }
      const typed = { p: null, meta: { title, author, year: '', publisher: '', cover: '' } };
      out.innerHTML = `<p class="row-label" style="margin-top:10px">${items.length ? 'Tap the matching book:' : 'Nothing found.'}</p>
        <div class="stack">${items.map((x, i) => `<button class="pick" type="button" data-i="${i}">
          ${x.meta.cover ? `<img src="${esc(x.meta.cover)}" alt="">` : '<span class="ph"></span>'}
          <span><b>${esc(x.meta.title)}</b><span>${esc([x.meta.author, x.meta.year && 'first published ' + x.meta.year].filter(Boolean).join(' · '))}</span></span></button>`).join('')}
        <button class="btn wide" type="button" data-i="typed">None of these — use “${esc(title)}”</button></div>`;
      $$('#tsResults [data-i]').forEach((b) => b.addEventListener('click', () => {
        const pick = b.dataset.i === 'typed' ? typed : items[+b.dataset.i];
        hideModal();
        dispatch(pick);
      }));
    };
    $('#tsGo').addEventListener('click', go);
    ['#tsTitle', '#tsAuthor'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
  }

  /* ---------------- Barcode scanners that act like a keyboard ---------------- */
  // A USB/Bluetooth scanner "types" the digits very fast and presses Enter.
  // We catch that anywhere on the page, even if the cursor is in another box.
  const burst = { chars: '', start: 0, last: 0, target: null, before: '' };
  document.addEventListener('keydown', (e) => {
    if (!$('#settingsView').classList.contains('hidden')) return;
    if (modalOpen() && !S.cam) return;
    const now = performance.now();
    if (/^[0-9Xx]$/.test(e.key)) {
      if (now - burst.last > 60) {
        burst.chars = ''; burst.start = now; burst.target = e.target;
        burst.before = e.target && 'value' in e.target ? e.target.value : '';
      }
      burst.chars += e.key; burst.last = now;
      return;
    }
    if (e.key === 'Enter' && burst.chars.length >= 10 && now - burst.last < 100) {
      const avg = (burst.last - burst.start) / Math.max(1, burst.chars.length - 1);
      if (avg < 45) {
        e.preventDefault(); e.stopPropagation();
        const code = burst.chars;
        const t = burst.target;
        if (t && 'value' in t && t.id !== 'isbnInput') { t.value = burst.before; }
        burst.chars = '';
        if (S.cam) { onCamCode(code); return; }
        $('#isbnInput').value = '';
        handleCode(code);
      }
    }
  }, true);

  /* ---------------- Settings screen ---------------- */
  function openSettingsLogin() {
    showModal(`<h2>Settings</h2><p>For the tool's organizer. Enter the Settings PIN.${PRACTICE ? ' <b>(Practice mode PIN: 1234)</b>' : ''}</p>
      <div class="stack"><input id="pinIn" class="text-input" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" autofocus>
      <div id="pinMsg" class="msg err"></div><button id="pinOk" class="btn primary wide" type="button">Open Settings</button></div>`);
    const go = async () => {
      const pin = $('#pinIn').value.trim();
      $('#pinOk').disabled = true;
      try {
        const info = await api('adminLogin', { pin });
        S.admin = { pin, info };
        hideModal();
        showSettings();
      } catch (e) {
        $('#pinMsg').textContent = e.message;
        $('#pinOk').disabled = false;
      }
    };
    $('#pinOk').addEventListener('click', go);
    $('#pinIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function showSettings() {
    const info = S.admin.info;
    const s = info.settings;
    const sec = info.secrets || {};
    const team = ls.get('team', '');
    let shareLink = '';
    if (team && IN_GAS && info.appUrl) shareLink = `${info.appUrl}?team=${encodeURIComponent(team)}`;
    else if (team && !IN_GAS) shareLink = `${location.origin}${location.pathname}#team=${encodeURIComponent(team)}`;
    const f = (key, label, help, type = 'number', extra = '') => `<div class="set-field"><label for="set_${key}">${label}</label>
      <input id="set_${key}" data-k="${key}" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(s[key])}" ${extra}>
      ${help ? `<div class="help">${help}</div>` : ''}</div>`;
    const sw = (key, label) => `<label class="switch"><input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}> ${label}</label>`;
    const ok = (yes, a = 'Saved ✓', b = 'Not set') => `<span class="${yes ? 'status-ok' : 'status-no'}">${yes ? a : b}</span>`;

    $('#settingsView').innerHTML = `
      <div class="set-head"><h2>⚙︎ Settings</h2><button id="setBack" class="btn small" type="button">← Back to scanning</button></div>
      <p class="muted">These settings are shared by everyone using the tool. ${info.practice ? '<b>Practice mode:</b> saved in this browser only.' : ''}</p>

      <div class="card"><h2>Value levels (colors)</h2>
        <p class="muted" style="margin-top:0">A book's value decides its color. Value = the volunteer's estimate if they typed one, otherwise the system's guess.</p>
        <div class="tier-row"><span class="mini-dot t1"></span><input data-k="tier1Name" type="text" class="text-input" value="${esc(s.tier1Name)}" aria-label="Level 1 name"><span class="from">under $${esc(s.tier2Min)}</span></div>
        ${[2, 3, 4].map((n) => `<div class="tier-row"><span class="mini-dot t${n}"></span><input data-k="tier${n}Name" type="text" class="text-input" value="${esc(s['tier' + n + 'Name'])}" aria-label="Level ${n} name">
          <div class="set-field"><input data-k="tier${n}Min" type="number" step="any" inputmode="decimal" value="${esc(s['tier' + n + 'Min'])}" aria-label="Level ${n} starts at $"><div class="help">starts at $</div></div></div>`).join('')}
        <div class="set-grid" style="margin-top:8px">
          ${f('askingPct', 'System guess: % of eBay asking price', 'Books usually sell for less than their asking price. 70 means a $10 asking price counts as $7.')}
          ${f('lowDataMin', '"Not much data" below', 'If fewer eBay listings than this, the color circle gets a dashed edge and a warning.')}
        </div></div>

      <div class="card"><h2>Suggested sale prices</h2>
        <p class="muted" style="margin-top:0">For the lowest level, books get a flat price by format. Above that, the price is a % of the value.</p>
        <div class="set-grid">
          ${f('pricePaperback', 'Paperback ($)')}${f('priceHardcover', 'Hardcover ($)')}
          ${f('priceMassMarket', 'Mass-market paperback ($)')}${f('priceOther', 'Other / unknown ($)')}
          ${f('pricePct', 'Higher levels: % of value', '50 means a $30 book is priced at $15.')}
          ${f('priceMin', 'Higher levels: lowest price ($)')}
          ${f('priceRound', 'Round prices to the nearest ($)', 'e.g. 0.5 for 50¢ steps, 1 for whole dollars.')}
        </div></div>

      <div class="card"><h2>Where to sell</h2>
        ${sw('whereOn', 'Fill in "Where to sell" (Book sale / Online)')}
        <div class="set-grid">${f('onlineMin', 'Suggest "Online" at or above ($)')}</div></div>

      <div class="card"><h2>Scanning</h2>
        ${sw('dupCheck', 'Warn when a book is already on the list')}
        <div class="set-field"><label for="set_rapidDup">In Rapid Scan, when a book is already on the list</label>
          <select id="set_rapidDup" data-k="rapidDup"><option value="addCopy" ${s.rapidDup !== 'newRow' ? 'selected' : ''}>Add 1 to its copies</option>
          <option value="newRow" ${s.rapidDup === 'newRow' ? 'selected' : ''}>Save it as a new row</option></select></div>
        ${sw('beep', 'Beep when a book is scanned')}</div>

      <div class="card"><h2>Volunteers</h2>
        <div class="set-field"><label for="set_volunteers">Names to pick from (one per line)</label>
          <textarea id="set_volunteers" data-k="volunteers">${esc(s.volunteers)}</textarea>
          <div class="help">Volunteers tap their name instead of typing it. Anyone can still type a different name.</div></div></div>

      <div class="card"><h2>Price sources</h2>
        <p><b>eBay listings</b> (free) — ${ok(sec.ebayIdSet && sec.ebaySecretSet, 'Connected ✓', 'Not connected')}</p>
        <div class="set-grid">
          <div class="set-field"><label for="sec_ebayId">eBay App ID (Client ID)</label><input id="sec_ebayId" data-sec="ebayId" type="text" autocomplete="off" placeholder="${sec.ebayIdSet ? 'Saved — leave blank to keep' : ''}"></div>
          <div class="set-field"><label for="sec_ebaySecret">eBay Cert ID (Client Secret)</label><input id="sec_ebaySecret" data-sec="ebaySecret" type="password" autocomplete="off" placeholder="${sec.ebaySecretSet ? 'Saved — leave blank to keep' : ''}"></div>
        </div>
        <p style="margin-top:18px"><b>Keepa — Amazon prices</b> (paid, about $20/month) — ${ok(sec.keepaKeySet, 'Key saved ✓', 'No key')}</p>
        ${sw('keepaOn', 'Use Keepa for Amazon prices and sales rank')}
        <div class="set-field"><label for="sec_keepaKey">Keepa API key</label><input id="sec_keepaKey" data-sec="keepaKey" type="password" autocomplete="off" placeholder="${sec.keepaKeySet ? 'Saved — leave blank to keep' : ''}"></div>
        <p class="muted">Keys are stored privately in Google Apps Script, never in the spreadsheet or on phones.</p></div>

      <div class="card"><h2>Access</h2>
        <p>Team code: ${ok(sec.teamCodeSet, 'Set ✓', 'Not set — anyone with the link can use the tool')}</p>
        <div class="set-grid">
          <div class="set-field"><label for="sec_teamCode">New team code</label><input id="sec_teamCode" data-sec="teamCode" type="text" autocomplete="off" placeholder="Leave blank to keep"></div>
          <div class="set-field"><label for="sec_adminPin">New Settings PIN</label><input id="sec_adminPin" data-sec="adminPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Leave blank to keep">
            ${sec.adminPinIsDefault ? '<div class="help" style="color:var(--danger)">Still the starting PIN (1234) — please change it.</div>' : ''}</div>
        </div>
        ${shareLink ? `<div class="set-field" style="margin-top:12px"><label for="shareLink">Link for volunteers (includes the team code)</label>
          <input id="shareLink" type="text" readonly value="${esc(shareLink)}"><div class="help">Send this link to volunteers and have them add it to their home screen. It signs them in every time.</div>
          <button id="copyLink" class="btn small" type="button" style="margin-top:6px">Copy link</button></div>` : ''}</div>

      <div class="card"><h2>General</h2>
        <div class="set-grid">${f('appName', 'Name at the top of the page', '', 'text')}</div>
        ${info.sheetUrl ? `<p><a class="btn wide" href="${esc(info.sheetUrl)}" target="_blank" rel="noopener">📊 Open the spreadsheet (${esc(info.bookCount)} books)</a></p>` : `<p class="muted">${esc(info.bookCount)} books saved in practice mode.</p>`}
        ${info.practice ? '<button id="practiceReset" class="btn small" type="button">Clear practice data</button>' : ''}</div>

      <div id="setMsg" class="msg" role="status"></div>
      <div class="save-bar"><button id="setSave" class="btn go wide" type="button">Save settings</button></div>`;

    $('#scanView').classList.add('hidden');
    $('#settingsView').classList.remove('hidden');
    window.scrollTo(0, 0);
    $('#setBack').addEventListener('click', closeSettings);
    $('#setSave').addEventListener('click', saveSettings);
    const copy = $('#copyLink');
    if (copy) copy.addEventListener('click', () => { $('#shareLink').select(); try { navigator.clipboard.writeText(shareLink); } catch (e) { document.execCommand('copy'); } toast('Link copied'); });
    const reset = $('#practiceReset');
    if (reset) reset.addEventListener('click', () => { window.DemoBackend.reset(); toast('Practice data cleared'); closeSettings(); });
  }

  async function saveSettings() {
    const out = {};
    $$('#settingsView [data-k]').forEach((el) => {
      const k = el.dataset.k;
      const d = window.DEFAULT_SETTINGS[k];
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (typeof d === 'number') out[k] = el.value === '' ? d : Number(el.value);
      else out[k] = el.value;
    });
    const msg = $('#setMsg');
    const bad = Object.keys(out).find((k) => typeof window.DEFAULT_SETTINGS[k] === 'number' && !isFinite(out[k]));
    if (bad) { msg.className = 'msg err'; msg.textContent = 'Please use plain numbers (no $ signs).'; return; }
    if (!(out.tier2Min < out.tier3Min && out.tier3Min < out.tier4Min)) {
      msg.className = 'msg err'; msg.textContent = 'Each value level must start higher than the one before it.'; return;
    }
    const secrets = {};
    $$('#settingsView [data-sec]').forEach((el) => { if (el.value.trim()) secrets[el.dataset.sec] = el.value.trim(); });
    $('#setSave').disabled = true;
    msg.className = 'msg'; msg.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const info = await api('saveSettings', { pin: S.admin.pin, settings: out, secrets });
      if (secrets.adminPin) S.admin.pin = secrets.adminPin;
      if (secrets.teamCode) ls.set('team', secrets.teamCode);
      S.admin.info = info;
      applySettings(info.settings);
      S.ebayReady = info.ebayReady; S.keepaReady = info.keepaReady;
      showSettings();
      const m = $('#setMsg');
      if (info.ebayTest && info.ebayTest !== 'ok') { m.className = 'msg err'; m.textContent = 'Saved, but eBay did not accept the keys: ' + info.ebayTest; }
      else { m.className = 'msg ok'; m.textContent = 'Saved ✓' + (info.ebayTest === 'ok' ? ' eBay is connected.' : ''); }
      toast('Settings saved ✓');
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = 'Not saved: ' + e.message;
      $('#setSave').disabled = false;
    }
  }

  function closeSettings() {
    S.admin = null;
    $('#settingsView').classList.add('hidden');
    $('#settingsView').innerHTML = '';
    $('#scanView').classList.remove('hidden');
    setMode(S.mode);
  }

  /* ---------------- Wire up + start ---------------- */
  $$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('[data-cond]').forEach((b) => b.addEventListener('click', () => setCond(b.dataset.cond)));
  $('#isbnForm').addEventListener('submit', (e) => { e.preventDefault(); handleCode($('#isbnInput').value); });
  // After live camera has failed once on this visit, go straight to the photo method.
  $('#camBtn').addEventListener('click', () => (S.liveCamFailed ? $('#photoInput').click() : openCamera()));
  $('#photoBtn').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) readPhoto(file);
  });
  $('#titleBtn').addEventListener('click', openTitleSearch);
  $('#whoBtn').addEventListener('click', pickName);
  $('#gearBtn').addEventListener('click', openSettingsLogin);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen()) hideModal(); });

  /** The volunteer link carries the team code: #team=… on a normal website, ?team=… on the Apps Script URL. */
  function readTeamFromLink() {
    if (IN_GAS && google.script.url) {
      return new Promise((resolve) => {
        google.script.url.getLocation((loc) => {
          const t = loc && loc.parameter && loc.parameter.team;
          if (t) ls.set('team', t);
          resolve();
        });
        setTimeout(resolve, 2000);
      });
    }
    const m = location.hash.match(/team=([^&]+)/);
    if (m) {
      ls.set('team', decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
    return Promise.resolve();
  }

  (async function start() {
    if (PRACTICE) $('#demoBanner').classList.remove('hidden');
    applySettings(S.settings);
    $('#whoName').textContent = S.who || 'Your name';
    setCond(S.cond);
    setMode(MODE_LABEL[S.mode] ? S.mode : 'quick');
    await readTeamFromLink();
    hello();
  })();
})();
