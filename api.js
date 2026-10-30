/* Public market data only. No account credentials or trading endpoints. */
const CryptoAPI = (() => {
  const REST = 'https://data-api.binance.vision/api/v3';
  const STREAM = 'wss://data-stream.binance.vision:443/stream';
  let blockedUntil = 0;

  async function request(path, params = {}, signal) {
    if (Date.now() < blockedUntil) throw new Error('API rate limit reached. Please wait before retrying.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try {
      const response = await fetch(`${REST}/${path}?${new URLSearchParams(params)}`, { signal: controller.signal });
      if (response.status === 429 || response.status === 418) {
        const retry = Number(response.headers.get('Retry-After'));
        blockedUntil = Date.now() + (retry > 0 ? retry * 1000 : 60000);
      }
      if (!response.ok) throw new Error(`Service unavailable (HTTP ${response.status}).`);
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  function ticker(raw, stream = false) {
    const data = stream ? {
      symbol: raw.s, price: Number(raw.c), pct: Number(raw.P), vol: Number(raw.q),
      high: Number(raw.h), low: Number(raw.l), change: Number(raw.p),
    } : {
      symbol: raw.symbol, price: Number(raw.lastPrice), pct: Number(raw.priceChangePercent),
      vol: Number(raw.quoteVolume), high: Number(raw.highPrice), low: Number(raw.lowPrice), change: Number(raw.priceChange),
    };
    if (typeof data.symbol !== 'string' || !Object.entries(data).every(([key, value]) => key === 'symbol' || Number.isFinite(value)) || data.price <= 0 || data.vol < 0 || data.low <= 0 || data.high < data.low) {
      throw new Error('Invalid market data.');
    }
    return data;
  }

  async function tickers(symbols) {
    const raw = await request('ticker/24hr', { symbols: JSON.stringify(symbols) });
    if (!Array.isArray(raw) || !raw.length) throw new Error('Prices are unavailable.');
    return raw.map(item => ticker(item));
  }
  async function rate() {
    const raw = await request('ticker/price', { symbol: 'USDTBRL' });
    const value = Number(raw.price);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Exchange rate is unavailable.');
    return value;
  }
  async function klines(symbol, interval, limit, signal) {
    const raw = await request('klines', { symbol, interval, limit }, signal);
    if (!Array.isArray(raw) || !raw.length || raw.some(k => !Array.isArray(k) || !Number.isFinite(Number(k[0])) || !Number.isFinite(Number(k[4])) || Number(k[4]) <= 0)) throw new Error('History is unavailable.');
    return raw.map(k => ({ time: Number(k[0]), close: Number(k[4]) }));
  }
  async function depth() {
    const raw = await request('depth', { symbol: 'BTCUSDT', limit: 5 });
    const valid = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row => Array.isArray(row) && Number.isFinite(Number(row[0])) && Number(row[0]) > 0 && Number.isFinite(Number(row[1])) && Number(row[1]) >= 0);
    if (!valid(raw.asks) || !valid(raw.bids)) throw new Error('Order book is unavailable.');
    return { asks: raw.asks.map(([p, v]) => ({ p: Number(p), v: Number(v) })), bids: raw.bids.map(([p, v]) => ({ p: Number(p), v: Number(v) })) };
  }
  return { request, ticker, tickers, rate, klines, depth, streamURL: symbols => `${STREAM}?streams=${symbols.map(s => s.toLowerCase() + '@ticker').join('/')}` };
})();
