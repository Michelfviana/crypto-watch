/* Chromium integration checks against a local HTTP stand-in, with real Chart.js.
   Run: npm run test:browser (CHROME_BIN overrides the chromium executable). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'TRXUSDT', 'LINKUSDT'];
const ticker = (symbol, i) => ({ symbol, lastPrice: String(68000 / (i + 1)), priceChangePercent: String(i % 2 ? -i : i + 1), quoteVolume: String(1000000 * (i + 1)), highPrice: '70000', lowPrice: '0.01', priceChange: '100' });
let failRate = false;
let failHistory = false;
let failMarket = false;
const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, status = 200) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } };
  if (url.pathname.startsWith('/api/v3/')) {
    requests.push(url.pathname);
    if (url.pathname.endsWith('/ticker/24hr')) return send(failMarket ? {} : symbols.map(ticker), failMarket ? 503 : 200);
    if (url.pathname.endsWith('/ticker/price')) return send(failRate ? {} : { price: '5.25' }, failRate ? 503 : 200);
    if (url.pathname.endsWith('/depth')) return send({ asks: [['68001', '1.25'], ['68002', '2']], bids: [['68000', '1'], ['67999', '1.5']] });
    if (url.pathname.endsWith('/klines')) {
      const rows = Array.from({ length: Number(url.searchParams.get('limit')) }, (_, i) => [Date.now() - i * 3600000, '1', '2', '1', String(68000 + i)]);
      return setTimeout(() => send(failHistory ? {} : rows, failHistory ? 503 : 200), url.searchParams.get('interval') === '1h' ? 250 : 30);
    }
    return send({}, 501);
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (url.pathname === '/js/api.js') body = body.toString().replace('https://data-api.binance.vision/api/v3', `http://127.0.0.1:${server.address().port}/api/v3`);
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(body);
});

(async () => {
  let chrome, socket;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptowatch-test-'));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const chromePath = process.env.CHROME_BIN || 'chromium';
    let chromeStderr = '';
    chrome = spawn(chromePath, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.stderr.setEncoding('utf8');
    chrome.stderr.on('data', chunk => { chromeStderr = (chromeStderr + chunk).slice(-4000); });
    const chromeError = new Promise(resolve => chrome.once('error', resolve));
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let port;
    for (let i = 0; i < 200; i++) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
      catch {
        if (chrome.exitCode !== null || chrome.signalCode !== null) break;
        const launchError = await Promise.race([chromeError, pause(100).then(() => null)]);
        if (launchError) break;
      }
    }
    if (!port) {
      const details = chromeStderr.trim();
      throw new Error(`Chromium did not expose its debugging port (executable: ${chromePath}, exit code: ${chrome.exitCode}, signal: ${chrome.signalCode})${details ? `\n${details}` : ''}`);
    }
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    const exceptions = [];
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
      pending.set(id, message => { clearTimeout(timeout); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); }
      throw new Error('Condition timed out: ' + expression);
    };
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `
      globalThis.testSockets = [];
      globalThis.WebSocket = class {
        constructor(url) { this.url = url; this.readyState = 0; testSockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 10); }
        close() { this.readyState = 3; this.onclose?.(); }
        emit(symbol, price, pct, vol = 9000000) { this.onmessage?.({data: JSON.stringify({data:{s:symbol,c:String(price),P:String(pct),q:String(vol),h:'100000',l:'0.01',p:'1'}})}); }
      };
    ` });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await cdp('Page.navigate', { url: origin });
    await wait('document.querySelectorAll("#tableBody tr[data-sym]").length === 10 && document.getElementById("brlRate").textContent.includes("5.25")');
    assert.equal(await evaluate('typeof Chart'), 'function');
    assert.equal(await evaluate('document.querySelector("#wsPill").classList.contains("connected")'), false, 'opening the socket alone does not indicate live data');
    await evaluate('testSockets.at(-1).emit("BTCUSDT", 68123, 12, 22000000)');
    await wait('document.querySelector("#tableBody tr[data-sym=BTCUSDT] .vl").textContent.includes("22.0M")');
    assert.equal(await evaluate('document.querySelector("#wsPill").classList.contains("connected")'), true);
    await evaluate('document.querySelector("#heatmap [data-open=BTCUSDT]").focus(); testSockets.at(-1).emit("BTCUSDT", 68130, 12)');
    await pause(500);
    assert.equal(await evaluate('document.activeElement.closest("#heatmap")?.id'), 'heatmap', 'heatmap retains focus during updates');
    await evaluate('document.querySelectorAll(".tab")[1].click()');
    assert.equal(await evaluate('document.querySelector("#tableBody tr").dataset.sym'), 'BTCUSDT');
    await evaluate('testSockets.at(-1).emit("ETHUSDT", 3500, 20)');
    await wait('document.querySelector("#tableBody tr").dataset.sym === "ETHUSDT"');
    assert.equal(await evaluate('[...document.querySelectorAll("#tableBody .chg")].every(el => parseFloat(el.textContent) > 0)'), true);
    await evaluate('document.querySelectorAll(".tab")[0].click(); document.querySelector("[data-fav=BTCUSDT]").focus(); testSockets.at(-1).emit("BTCUSDT", 68200, 13)');
    await pause(500);
    assert.equal(await evaluate('document.activeElement.dataset.fav'), 'BTCUSDT', 'stream updates retain keyboard focus');
    await evaluate('document.querySelector("[data-fav=BTCUSDT]").click(); setCurrency("BRL")');
    await cdp('Page.reload');
    await wait('document.querySelectorAll("#tableBody tr[data-sym]").length === 10');
    assert.equal(await evaluate('document.querySelector("[data-fav=BTCUSDT]").getAttribute("aria-pressed")'), 'true');
    assert.equal(await evaluate('document.querySelector("#btnBRL").getAttribute("aria-pressed")'), 'true');
    await evaluate('document.querySelector("[data-open=BTCUSDT]").click(); loadKlines("1d", "30d", document.querySelectorAll(".tf-btn")[2])');
    await wait('document.querySelector("#modalChartLabel").textContent.includes("30D")');
    await pause(350);
    assert.equal(await evaluate('document.querySelector("#modalChartLabel").textContent.includes("30D")'), true, 'slow old chart cannot replace the selected period');
    await evaluate('document.querySelector("#calcInput").value = "-1"; calcConvert()');
    assert.equal(await evaluate('document.querySelector("#calcInput").getAttribute("aria-invalid")'), 'true');
    await evaluate('closeModal()');
    failHistory = true;
    await evaluate('historyCache.clear(); openModal("ETHUSDT")');
    await wait('document.querySelector("#chartStatus").textContent.includes("unavailable")');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait('!document.querySelector("#modalOverlay").open');
    failRate = true;
    await evaluate('fetchBRL()');
    assert.equal(await evaluate('document.querySelector("#tableBody .ptd").textContent'), '—', 'failed conversion cannot use a fictitious rate');
    await evaluate('window.dispatchEvent(new Event("offline"))');
    assert.equal(await evaluate('document.querySelector("#wsPill").classList.contains("connected")'), false);
    assert.equal(await evaluate('document.querySelector("#wsLabel").textContent'), 'Offline');
    await evaluate('window.dispatchEvent(new Event("online"))');
    await wait('testSockets.length > 1');
    assert.equal(await evaluate('testSockets.at(-2).readyState'), 3);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'desktop fits viewport');
    failRate = false;
    await evaluate('fetchBRL()');
    await evaluate('setCurrency("USDT"); testSockets.at(-1).emit("BTCUSDT", 68200, 13)');
    await pause(500);
    await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then(r => fs.writeFileSync('/tmp/cryptowatch-desktop.png', Buffer.from(r.data, 'base64')));
    for (const width of [390, 320]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await pause(150);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `page fits ${width}px viewport`);
      assert.equal(await evaluate('document.querySelector("#tableBody .ptd").getBoundingClientRect().right <= innerWidth'), true, 'mobile price is visible without scrolling');
      await evaluate('openModal("BTCUSDT")');
      assert.equal(await evaluate('document.querySelector(".modal").getBoundingClientRect().right <= innerWidth'), true, 'mobile dialog fits');
      await evaluate('closeModal()');
    }
    await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then(r => fs.writeFileSync('/tmp/cryptowatch-mobile.png', Buffer.from(r.data, 'base64')));
    // Breadth follows the sign of the rolling 24h change, not each price tick.
    await evaluate('COINS.forEach(c => testSockets.at(-1).emit(c.s, 100, -1))');
    await wait('document.querySelector("#breadthNum").textContent === "0%"');
    await evaluate('testSockets.at(-1).emit("BTCUSDT", 101, 0.5)');
    await wait('document.querySelector("#breadthNum").textContent === "10%"');
    assert.equal(await evaluate('document.querySelector("#breadthLbl").textContent'), '1 of 10 gaining');
    await evaluate('testSockets.at(-1).emit("BTCUSDT", 102, 0.8)');
    await wait('document.querySelector("#tableBody tr[data-sym=BTCUSDT] .ptd").textContent.includes("102")');
    assert.equal(await evaluate('document.querySelector("#breadthNum").textContent'), '10%', 'higher price with the same sign keeps breadth unchanged');
    await evaluate('testSockets.at(-1).emit("ETHUSDT", 101, 0.1)');
    await wait('document.querySelector("#breadthNum").textContent === "20%"');
    assert.equal(await evaluate('document.querySelector("#breadthProgress").getAttribute("aria-valuenow")'), '20');
    await evaluate('testSockets.at(-1).emit("ETHUSDT", 100, 0)');
    await wait('document.querySelector("#breadthNum").textContent === "10%"');
    assert.equal(await evaluate('document.querySelector("#breadthSummary").textContent'), '8 declining · 1 unchanged');
    assert.equal(await evaluate('document.querySelector("#breadthStatus").textContent.includes("Last data at")'), true);
    await evaluate('window.dispatchEvent(new Event("offline"))');
    assert.equal(await evaluate('document.querySelector("#breadthStatus").textContent.includes("Live updates unavailable")'), true);
    failMarket = true;
    await evaluate('localStorage.clear()');
    await cdp('Page.reload');
    await wait('document.querySelector("#notice").textContent.includes("unavailable")');
    assert.equal(await evaluate('document.querySelector("#wsPill").classList.contains("connected")'), false);
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    for (const endpoint of ['/ticker/24hr', '/ticker/price', '/depth', '/klines']) assert.ok(requests.some(r => r.endsWith(endpoint)), endpoint + ' exercised over HTTP');
    console.log('Browser checks passed: real Chart.js, stream updates, ranking, focus, persistence, history race, Escape, conversion failure, offline/reconnect, initial failure, desktop and 320/390px mobile.');
    console.log('Screenshots: /tmp/cryptowatch-desktop.png and /tmp/cryptowatch-mobile.png');
  } finally {
    socket?.close();
    if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
      // Wait for shutdown instead of deleting a profile Chromium is still using.
      const closed = new Promise(resolve => chrome.once('close', resolve));
      const forceKill = setTimeout(() => chrome.kill('SIGKILL'), 5000);
      try {
        chrome.kill('SIGTERM');
        await closed;
      } finally {
        clearTimeout(forceKill);
      }
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Child processes can finish writing shortly after the main process exits.
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
