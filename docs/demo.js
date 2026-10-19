// Practice mode: stands in for the Google Sheet backend when config.js has no backendUrl.
// Prices are made up (but the same every time for the same book); the "list" lives in this browser only.
window.DemoBackend = (() => {
  const KEY = 'bsh_practice_v1';
  const blank = () => ({ books: [], sales: [], settings: null, pin: '1234', team: '', nextId: 1 });
  let db = (() => {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { return blank(); }
  })();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode */ } };
  const settings = () => Object.assign({}, window.DEFAULT_SETTINGS, db.settings || {});
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function rng(seed) {
    let h = 2166136261;
    for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }

  function fakeEbay(key, cond) {
    const r = rng(key + '|' + cond);
    const roll = r();
    const count = roll < 0.12 ? 0 : roll < 0.3 ? 1 + Math.floor(r() * 2) : 3 + Math.floor(r() * 25);
    if (!count) return { total: 0, used: 0, low: null, median: null, high: null, items: [] };
    const band = r();
    const base = band < 0.6 ? 3 + r() * 7 : band < 0.82 ? 10 + r() * 20 : band < 0.94 ? 30 + r() * 40 : 70 + r() * 150;
    const mult = cond === 'new' ? 1.4 : 1;
    const conds = cond === 'new' ? ['Brand New'] : ['Good', 'Very Good', 'Acceptable', 'Like New'];
    const prices = [...Array(count)].map(() => Logic.round2(base * mult * (0.6 + r() * 0.9))).sort((a, b) => a - b);
    const items = prices.slice(0, 24).map((p, i) => ({
      title: '', price: p, ship: r() < 0.4 ? 0 : Logic.round2(3 + r() * 3), cond: conds[i % conds.length],
      auction: r() < 0.15, url: 'https://www.ebay.com/', img: '',
    }));
    return { total: count, used: count, low: prices[0], median: Logic.median(prices), high: prices[prices.length - 1], items };
  }

  function bookView(b) {
    const s = settings();
    const value = b.yourEst !== '' && b.yourEst != null ? Number(b.yourEst) : b.sysEst;
    const sold = db.sales.filter((x) => x.id === b.id).reduce((t, x) => t + x.qty, 0);
    return {
      id: b.id, title: b.title, author: b.author, copies: b.copies, sold, value: value == null ? null : value,
      level: Logic.tier(value, s).name, suggested: Logic.suggestedPrice(value, b.format, s),
      final: b.final === '' || b.final == null ? null : Number(b.final), box: b.box,
    };
  }

  function find(isbn13, title, author, id) {
    const t = String(title || '').trim().toLowerCase();
    const a = String(author || '').trim().toLowerCase();
    return db.books.find((b) => (id && b.id === id) || (isbn13 && b.isbn13 === isbn13) ||
      (!isbn13 && !id && t && b.title.toLowerCase() === t && (!a || b.author.toLowerCase() === a)));
  }

  function addBook(b) {
    const book = Object.assign({}, b, { id: 'B' + String(db.nextId++).padStart(5, '0'), added: new Date().toISOString() });
    db.books.push(book);
    persist();
    return book;
  }

  const handlers = {
    async hello() { return { settings: settings(), ebayReady: true, keepaReady: false }; },

    async lookup(req) {
      await wait(500 + Math.random() * 500);
      const s = settings();
      const key = req.isbn || String(req.title || '').toLowerCase();
      const ebay = fakeEbay(key, req.condition === 'new' ? 'new' : 'used');
      const dupBook = s.dupCheck ? find(req.isbn, req.title, req.author) : null;
      return { ebay, keepa: null, estimate: Logic.estimate(ebay, null, s), dup: dupBook ? bookView(dupBook) : null };
    },

    async save(req) {
      await wait(300);
      const b = req.book;
      if (req.dupId) {
        const ex = find(null, null, null, req.dupId);
        if (ex) {
          ex.copies = (Number(ex.copies) || 1) + (Number(b.copies) || 1);
          persist();
          return { id: ex.id, action: 'addedCopy', copies: ex.copies };
        }
      }
      const book = addBook(b);
      return { id: book.id, action: 'added', copies: book.copies };
    },

    async rapidSave(req) {
      const s = settings();
      const ex = s.dupCheck ? find(req.isbn, req.title, req.author) : null;
      if (ex && s.rapidDup !== 'newRow') {
        await wait(300);
        ex.copies = (Number(ex.copies) || 1) + 1;
        persist();
        const v = bookView(ex);
        return { dup: true, id: ex.id, title: ex.title, copies: ex.copies, value: v.value, level: v.level };
      }
      const meta = req.isbn ? await window.fetchMeta({ isbn13: req.isbn }) : { title: req.title, author: req.author };
      const key = req.isbn || String(req.title || '').toLowerCase();
      const ebay = fakeEbay(key, req.condition === 'new' ? 'new' : 'used');
      const est = Logic.estimate(ebay, null, s);
      await wait(400 + Math.random() * 900);
      const book = addBook({
        isbn13: req.isbn || '', title: (meta && meta.title) || req.title || '', author: (meta && meta.author) || req.author || '',
        year: (meta && meta.year) || '', copies: 1, searched: req.condition, sysEst: est.value, basis: est.basis,
        ebayCount: ebay.used, by: req.by, mode: 'Rapid Scan', format: '',
      });
      return { id: book.id, dup: !!ex, title: book.title, value: est.value, lowData: est.lowData, ebayCount: ebay.used };
    },

    async findBook(req) {
      await wait(300);
      const b = find(req.isbn, req.title, req.author);
      return { book: b ? bookView(b) : null };
    },

    async markSold(req) {
      await wait(300);
      db.sales.push({ date: new Date().toISOString(), by: req.by, id: req.id || '', isbn: req.isbn || '', title: req.title || '', price: req.price, qty: Number(req.qty) || 1 });
      persist();
      return { recorded: true };
    },

    async adminLogin(req) {
      await wait(200);
      if (String(req.pin || '').trim() !== db.pin) throw new Error('That PIN is not right. (In Practice mode the PIN is 1234.)');
      return adminInfo();
    },

    async saveSettings(req) {
      await wait(300);
      if (String(req.pin || '').trim() !== db.pin) throw new Error('That PIN is not right.');
      db.settings = Object.assign(settings(), req.settings || {});
      const sec = req.secrets || {};
      if (sec.adminPin) db.pin = String(sec.adminPin).trim();
      if (sec.teamCode) db.team = String(sec.teamCode).trim();
      persist();
      return Object.assign(adminInfo(), { ebayTest: null });
    },
  };

  function adminInfo() {
    return {
      settings: settings(), ebayReady: true, keepaReady: false,
      secrets: { teamCodeSet: !!db.team, adminPinIsDefault: db.pin === '1234', ebayIdSet: false, ebaySecretSet: false, keepaKeySet: false },
      sheetUrl: '', bookCount: db.books.length, practice: true,
    };
  }

  async function call(action, data) {
    const h = handlers[action];
    if (!h) throw new Error('Unknown action ' + action);
    return Object.assign({ ok: true }, await h(data || {}));
  }

  function reset() { db = blank(); persist(); }
  function dump() { return JSON.parse(JSON.stringify(db)); }

  return { call, reset, dump };
})();
