// Pricing rules shared by the page and Practice mode.
// The same rules live in the spreadsheet as formulas (apps-script/Code.gs) — keep them in step.

window.DEFAULT_SETTINGS = {
  appName: 'Book Sale Helper',
  tier1Name: 'Standard',
  tier2Name: 'Good Find', tier2Min: 5,
  tier3Name: 'Valuable', tier3Min: 15,
  tier4Name: 'High Value', tier4Min: 40,
  askingPct: 70,
  lowDataMin: 3,
  whereOn: true,
  onlineMin: 40,
  pricePaperback: 1, priceHardcover: 2, priceMassMarket: 0.5, priceOther: 1,
  pricePct: 50, priceMin: 1, priceRound: 0.5,
  dupCheck: true,
  rapidDup: 'addCopy',
  beep: true,
  keepaOn: false,
  volunteers: '',
};

window.Logic = (() => {
  const round2 = (n) => Math.round(n * 100) / 100;

  function median(sorted) {
    if (!sorted.length) return null;
    const m = Math.floor(sorted.length / 2);
    return round2(sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2);
  }

  /** The system's guess at a book's value, from eBay asking prices (or Keepa if that's all there is). */
  function estimate(ebay, keepa, s) {
    const pct = Number(s.askingPct) / 100;
    if (ebay && ebay.median != null) {
      return {
        value: round2(ebay.median * pct),
        basis: `eBay asking prices (middle of ${ebay.used}) × ${s.askingPct}%`,
        lowData: ebay.used < Number(s.lowDataMin),
      };
    }
    const k = keepa && (keepa.usedAvg90 || keepa.usedNow);
    if (k) return { value: round2(k * pct), basis: `Amazon used price (Keepa) × ${s.askingPct}%`, lowData: false };
    return { value: null, basis: 'No price data found', lowData: true };
  }

  /** Which of the 4 value levels a $ value falls in. */
  function tier(value, s) {
    if (value == null || value === '' || isNaN(value)) return { key: 'none', name: 'No data' };
    const v = Number(value);
    if (v >= s.tier4Min) return { key: 't4', name: s.tier4Name };
    if (v >= s.tier3Min) return { key: 't3', name: s.tier3Name };
    if (v >= s.tier2Min) return { key: 't2', name: s.tier2Name };
    return { key: 't1', name: s.tier1Name };
  }

  function standardPrice(format, s) {
    if (format === 'Hardcover') return s.priceHardcover;
    if (format === 'Mass market') return s.priceMassMarket;
    if (format === 'Paperback') return s.pricePaperback;
    return s.priceOther;
  }

  /** Suggested sale-day price. Level-1 books use flat prices by format; others are a % of value. */
  function suggestedPrice(value, format, s) {
    if (value == null || value === '' || Number(value) < s.tier2Min) return standardPrice(format, s);
    const step = Number(s.priceRound) || 1;
    const raw = (Number(value) * Number(s.pricePct)) / 100;
    return Math.max(Number(s.priceMin), round2(Math.round(raw / step) * step));
  }

  function whereToSell(value, s) {
    if (!s.whereOn) return '';
    return value != null && value !== '' && Number(value) >= s.onlineMin ? 'Online' : 'Book sale';
  }

  return { round2, median, estimate, tier, standardPrice, suggestedPrice, whereToSell };
})();
