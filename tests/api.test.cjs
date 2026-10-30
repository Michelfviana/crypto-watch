const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const http = require('node:http');

function load(fetcher = fetch, timers = { setTimeout, clearTimeout }) {
  const context = vm.createContext({ fetch: fetcher, URLSearchParams, AbortController, Date, ...timers });
  vm.runInContext(fs.readFileSync('api.js', 'utf8') + '\nglobalThis.api = CryptoAPI;', context);
  return context.api;
}
const ticker = { symbol: 'BTCUSDT', lastPrice: '68000', priceChangePercent: '2.5', quoteVolume: '1000000', highPrice: '69000', lowPrice: '65000', priceChange: '1600' };

test('normalizes market data and rejects invalid prices', () => {
  const api = load();
  assert.equal(api.ticker(ticker).price, 68000);
  for (const price of ['bad', 'Infinity', '0', '-1']) assert.throws(() => api.ticker({ ...ticker, lastPrice: price }), /inválidos/);
});

test('uses encoded symbols and validates all upstream schemas', async () => {
  const calls = [];
  let body = [ticker];
  const api = load(async url => { calls.push(new URL(url)); return new Response(JSON.stringify(body)); });
  assert.equal((await api.tickers(['BTCUSDT']))[0].vol, 1000000);
  assert.equal(calls[0].searchParams.get('symbols'), '["BTCUSDT"]');
  body = { code: -1121, msg: 'Invalid symbol' };
  await assert.rejects(api.tickers(['BTCUSDT']), /indisponíveis/);
  body = { price: 'NaN' };
  await assert.rejects(api.rate(), /indisponível/);
  body = [];
  await assert.rejects(api.klines('BTCUSDT', '1h', 24), /indisponível/);
  body = { asks: [['1', 'NaN']], bids: [['1', '2']] };
  await assert.rejects(api.depth(), /indisponível/);
  body = { asks: [['68001', '1.2']], bids: [['68000', '2.4']] };
  assert.equal((await api.depth()).asks[0].v, 1.2);
});

test('HTTP failures and rate limits do not silently produce prices', async () => {
  let count = 0;
  const api = load(async () => { count++; return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }); });
  await assert.rejects(api.rate(), /HTTP 429/);
  await assert.rejects(api.rate(), /Limite/);
  assert.equal(count, 1);
  await assert.rejects(load(async () => new Response('<html>unavailable</html>', { status: 503 })).rate(), /HTTP 503/);
});

test('real HTTP request cancellation and timeout propagate to the caller', async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/slow')) return;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ price: '5.25' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    // Keep the production request implementation, change only the dependency origin.
    const api = load((url, options) => fetch(origin + new URL(url).pathname.replace('/api/v3', ''), options));
    assert.equal(await api.rate(), 5.25);
    const controller = new AbortController();
    const pending = api.request('slow', {}, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    const fastTimeout = load((url, options) => fetch(origin + '/slow', options), { setTimeout: callback => setTimeout(callback, 20), clearTimeout });
    await assert.rejects(fastTimeout.rate(), { name: 'AbortError' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('preferences recover from corrupt data and blocked storage', () => {
  for (const saved of ['null', '{broken', '42']) {
    const context = vm.createContext({ localStorage: { getItem: () => saved, setItem() { throw new Error('disabled'); } } });
    vm.runInContext(fs.readFileSync('preferences.js', 'utf8') + '\nglobalThis.prefs = Preferences;', context);
    assert.equal(Object.keys(context.prefs.read()).length, 0);
    assert.doesNotThrow(() => context.prefs.write({ favs: ['BTCUSDT'] }));
  }
});
