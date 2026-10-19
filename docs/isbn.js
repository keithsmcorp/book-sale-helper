// ISBN helpers: clean up typed/scanned input, check the check digit, convert 10 <-> 13.
window.ISBN = (() => {
  const clean = (raw) => String(raw || '').toUpperCase().replace(/[^0-9X]/g, '');

  function valid10(s) {
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : +s[i]) * (10 - i);
    return sum % 11 === 0;
  }

  function valid13(s) {
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += +s[i] * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }

  function to13(s10) {
    const core = '978' + s10.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }

  function to10(s13) {
    if (!s13.startsWith('978')) return null; // 979 ISBNs have no 10-digit form
    const core = s13.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += +core[i] * (10 - i);
    const c = (11 - (sum % 11)) % 11;
    return core + (c === 10 ? 'X' : String(c));
  }

  /** Returns {ok, isbn13, isbn10} or {ok:false, reason, message}. */
  function parse(raw) {
    let s = clean(raw);
    if (!s) return fail('empty', 'Type or scan an ISBN first.');
    // Some scanners add the 2- or 5-digit price code after the ISBN.
    if ((s.length === 15 || s.length === 18) && /^97[89]/.test(s)) s = s.slice(0, 13);
    if (s.length === 13) {
      if (!/^97[89]/.test(s)) return fail('notbook', "That barcode isn't an ISBN — it's probably a store price code. Look for the ISBN on the back cover or the copyright page.");
      if (!valid13(s)) return fail('checksum', 'That ISBN has a typo somewhere. Please check the numbers.');
      return { ok: true, isbn13: s, isbn10: to10(s) };
    }
    if (s.length === 10) {
      if (!valid10(s)) return fail('checksum', 'That ISBN has a typo somewhere. Please check the numbers.');
      return { ok: true, isbn13: to13(s), isbn10: s };
    }
    if (s.length === 12 || s.length === 8) {
      return fail('upc', "That barcode isn't an ISBN — it's a store code (common on older paperbacks). Look for the ISBN on the back cover or the copyright page.");
    }
    return fail('length', 'An ISBN has 10 or 13 digits. Please check the numbers.');
  }

  function fail(reason, message) { return { ok: false, reason, message }; }

  /** Finds valid ISBNs in OCR text from a photo. */
  function findInText(text) {
    const found = new Map();
    const scan = (t) => {
      const re = /(?:97[89][\s\-–.]*)?(?:\d[\s\-–.]*){9}[\dXx]/g;
      let m;
      while ((m = re.exec(t))) {
        const p = parse(m[0]);
        if (p.ok) found.set(p.isbn13, p);
      }
    };
    scan(text);
    // OCR often reads 0 as O and 1 as I or l.
    scan(text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1'));
    return [...found.values()];
  }

  function pretty(p) { return p.isbn13; }

  return { parse, findInText, pretty };
})();
