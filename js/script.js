const COINS = [
  {
    s: "BTCUSDT",
    n: "Bitcoin",
    t: "BTC",
    i: "₿",
    c: "#F7931A",
    bg: "rgba(247,147,26,0.14)",
  },
  {
    s: "ETHUSDT",
    n: "Ethereum",
    t: "ETH",
    i: "Ξ",
    c: "#627EEA",
    bg: "rgba(98,126,234,0.14)",
  },
  {
    s: "BNBUSDT",
    n: "BNB",
    t: "BNB",
    i: "B",
    c: "#F3BA2F",
    bg: "rgba(243,186,47,0.14)",
  },
  {
    s: "SOLUSDT",
    n: "Solana",
    t: "SOL",
    i: "◎",
    c: "#9945FF",
    bg: "rgba(153,69,255,0.14)",
  },
  {
    s: "XRPUSDT",
    n: "XRP",
    t: "XRP",
    i: "X",
    c: "#00AAE4",
    bg: "rgba(0,170,228,0.14)",
  },
  {
    s: "DOGEUSDT",
    n: "Dogecoin",
    t: "DOGE",
    i: "D",
    c: "#C8A200",
    bg: "rgba(200,162,0,0.13)",
  },
  {
    s: "ADAUSDT",
    n: "Cardano",
    t: "ADA",
    i: "₳",
    c: "#538FFE",
    bg: "rgba(83,143,254,0.13)",
  },
  {
    s: "AVAXUSDT",
    n: "Avalanche",
    t: "AVAX",
    i: "A",
    c: "#E84142",
    bg: "rgba(232,65,66,0.12)",
  },
  {
    s: "TRXUSDT",
    n: "TRON",
    t: "TRX",
    i: "T",
    c: "#FF3040",
    bg: "rgba(255,48,64,0.12)",
  },
  {
    s: "LINKUSDT",
    n: "Chainlink",
    t: "LINK",
    i: "L",
    c: "#2A5ADA",
    bg: "rgba(42,90,218,0.13)",
  },
];
const getCoin = (s) => COINS.find((c) => c.s === s);

const fmtUSDT = (p) => {
  p = parseFloat(p);
  if (p >= 1000)
    return (
      "₮" +
      p.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  if (p >= 1) return "₮" + p.toFixed(4);
  return "₮" + p.toFixed(6);
};
const fmtBRL = (p, r) => {
  if (!Number.isFinite(r)) return "—";
  const v = parseFloat(p) * r;
  if (v >= 1000)
    return (
      "R$" +
      v.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  return "R$" + v.toFixed(4);
};
const fmtV = (v) => {
  v = parseFloat(v);
  if (v >= 1e9) return "₮" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "₮" + (v / 1e6).toFixed(1) + "M";
  return "₮" + (v / 1e3).toFixed(0) + "K";
};

let liveData = {};
let lastP = {};
let mini = {};
const savedPreferences = Preferences.read();
let brlRate = null;
let brlUpdated = 0;
let currency = savedPreferences.currency === "BRL" ? "BRL" : "USDT";
let favs = new Set(Array.isArray(savedPreferences.favs) ? savedPreferences.favs.filter(s => getCoin(s)) : []);
let favsOnly = false;
let currentTab = 0;
let sortState = { col: "rank", dir: 1 };
let currentModal = null;
let modalChartInst = null;
let ws = null;
let wsReconnectTimer = null;
let tickCount = 0;
let lastMessageTime = 0;
let marketUpdatedAt = 0;
let reconnectAttempt = 0;
let connectionState = "connecting";
let stopped = false;
let chartController = null;
let chartRequest = 0;
let modalTrigger = null;
let orderBookData = null;
let orderBookBusy = false;
let initialBusy = false;
let rateBusy = false;
const historyCache = new Map();
function savePreferences() { Preferences.write({ currency, favs: [...favs] }); }
function announce(message) {
  const notice = document.getElementById("notice");
  if (notice.textContent !== message) notice.textContent = message;
}

COINS.forEach((c) => {
  mini[c.s] = [];
});

const fmtPrice = (p) => (currency === "BRL" ? fmtBRL(p, brlRate) : fmtUSDT(p));

function setCurrency(cur) {
  currency = cur;
  savePreferences();
  document.getElementById("btnUSDT").classList.toggle("active", cur === "USDT");
  document.getElementById("btnBRL").classList.toggle("active", cur === "BRL");
  document.getElementById("btnUSDT").setAttribute("aria-pressed", cur === "USDT");
  document.getElementById("btnBRL").setAttribute("aria-pressed", cur === "BRL");
  renderAll();
  if (orderBookData) renderOrderBook();
}

async function fetchBRL() {
  if (rateBusy || !navigator.onLine) return;
  rateBusy = true;
  try {
    brlRate = await CryptoAPI.rate();
    brlUpdated = Date.now();
    document.getElementById("brlRate").textContent = "USDT/BRL · R$ " + brlRate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    renderAll();
    if (currentModal) updateModal(currentModal);
  } catch {
    document.getElementById("brlRate").textContent = brlUpdated ? "USDT/BRL · outdated" : "USDT/BRL unavailable";
    brlRate = null;
    renderAll();
    if (currentModal) updateModal(currentModal);
  } finally { rateBusy = false; }
}

async function fetchInitial() {
  if (initialBusy || !navigator.onLine) return;
  initialBusy = true;
  try {
    const data = await CryptoAPI.tickers(COINS.map(c => c.s));
    data.forEach(d => {
      if (!getCoin(d.symbol)) return;
      // A REST request started earlier must not overwrite newer stream data.
      if (connectionState === "live" && liveData[d.symbol]) return;
      liveData[d.symbol] = d;
      marketUpdatedAt = Date.now();
      mini[d.symbol].push(d.price);
      mini[d.symbol] = mini[d.symbol].slice(-16);
    });
    renderAll();
    announce("");
  } catch {
    if (!Object.keys(liveData).length) {
      document.getElementById("tableBody").innerHTML = '<tr><td colspan="7" class="empty-state">Unable to load prices. Check your connection and try again.</td></tr>';
      announce("Prices are unavailable. You can try reconnecting.");
    }
  } finally { initialBusy = false; }
}

function scheduleReconnect() {
  clearTimeout(wsReconnectTimer);
  if (stopped || !navigator.onLine) return;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt++, 5)) + Math.random() * 500;
  wsReconnectTimer = setTimeout(connectWS, delay);
}

function connectWS() {
  clearTimeout(wsReconnectTimer);
  if (stopped || !navigator.onLine) { setWsStatus("offline", "Offline"); return; }
  if (ws) { ws.onclose = null; ws.close(); }
  setWsStatus("connecting", "Connecting...");
  let socket;
  try { socket = new WebSocket(CryptoAPI.streamURL(COINS.map(c => c.s))); }
  catch { setWsStatus("error", "Connection unavailable"); scheduleReconnect(); return; }
  ws = socket;
  lastMessageTime = Date.now();
  socket.onopen = () => {
    if (ws !== socket) return;
    lastMessageTime = Date.now();
    setWsStatus("connecting", "Waiting for data...");
  };
  socket.onmessage = e => {
    if (ws !== socket || stopped) return;
    try {
      const d = CryptoAPI.ticker(JSON.parse(e.data).data, true);
      if (!getCoin(d.symbol)) return;
      lastMessageTime = Date.now();
      reconnectAttempt = 0;
      setWsStatus("live", "Live");
      announce("");
      liveData[d.symbol] = d;
      marketUpdatedAt = Date.now();
      mini[d.symbol].push(d.price);
      mini[d.symbol] = mini[d.symbol].slice(-16);
      tickCount++;
      document.getElementById("tickCounter").textContent = `${tickCount} updates`;
      onPriceUpdate(d.symbol);
    } catch (error) { console.warn("Ignored market message:", error.message); }
  };
  socket.onerror = () => { if (ws === socket) setWsStatus("error", "Connection error"); };
  socket.onclose = () => {
    if (ws !== socket || stopped) return;
    setWsStatus(navigator.onLine ? "reconnecting" : "offline", navigator.onLine ? "Reconnecting..." : "Offline");
    scheduleReconnect();
  };
}

function setWsStatus(state, label) {
  if (connectionState === state && document.getElementById("wsLabel").textContent === label) return;
  connectionState = state;
  document.getElementById("wsPill").className = "pill p-ws " + (state === "live" ? "connected" : state === "error" ? "error" : "");
  document.getElementById("wsDot").style.background = state === "live" ? "var(--g)" : "var(--y)";
  document.getElementById("wsLabel").textContent = label;
  document.getElementById("wsStatusDot").className = "ws-dot" + (state === "live" ? " live" : "");
  document.getElementById("wsStatusLabel").textContent = label;
  document.querySelector(".cdot").style.background = state === "live" ? "var(--g)" : "var(--y)";
  document.getElementById("connTxt").textContent = state === "live" ? "Binance · live market data" : "Binance · " + label;
  updateMarketBreadth();
}

const pendingUpdates = new Set();
let rafScheduled = false;
function onPriceUpdate(sym) {
  pendingUpdates.add(sym);
  if (!rafScheduled) {
    rafScheduled = true;
    setTimeout(() => requestAnimationFrame(flushUpdates), 300);
  }
}

function flushUpdates() {
  rafScheduled = false;
  const syms = [...pendingUpdates];
  pendingUpdates.clear();
  renderTable();
  syms.forEach((sym) => updateCoinUI(sym));
  updateMarketBreadth();
  updateBarChart();
  updateMarquee();
  updateHeatmap();
  renderMovers();
  renderVolBars();
  if (currentModal && syms.includes(currentModal)) updateModal(currentModal);
  document.getElementById("footerTs").textContent =
    "Updated " + new Date().toLocaleTimeString("en-US");
}

// Keep keyboard focus when a changing widget replaces its buttons.
function replaceWidget(id, markup) {
  const container = document.getElementById(id);
  const active = container.contains(document.activeElement) ? document.activeElement.dataset.open : null;
  container.innerHTML = markup;
  if (active) {
    const replacement = container.querySelector(`[data-open="${active}"]`);
    (replacement || document.getElementById("searchInput")).focus({ preventScroll: true });
  }
}

const skCharts = {};
function initHero() {
  const hg = document.getElementById("heroGrid");
  hg.innerHTML = COINS.slice(0, 5)
    .map(
      (coin) => `
    <button type="button" class="hcard" id="hcard-${coin.s}" onclick="openModal('${coin.s}')">
      <div class="hc-s">${coin.t}/USDT</div>
      <div class="hc-p" id="hp-${coin.s}">—</div>
      <div class="hc-pct" id="hpct-${coin.s}">—</div>
      <div class="hc-hl" id="hhl-${coin.s}">H:— L:—</div>
      <canvas class="hc-spark" id="hsk-${coin.s}" role="img" aria-label="${coin.t} sparkline"></canvas>
    </button>`,
    )
    .join("");
  if (typeof Chart === "undefined") return;
  COINS.slice(0, 5).forEach((coin) => {
    const cv = document.getElementById("hsk-" + coin.s);
    if (!cv) return;
    skCharts[coin.s] = new Chart(cv, {
      type: "line",
      data: {
        labels: Array(16).fill(""),
        datasets: [
          {
            data: [],
            borderColor: "#00E88A",
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  });
}

function updateCoinUI(sym) {
  const d = liveData[sym];
  if (!d) return;
  const prev = lastP[sym];
  const isUp = d.pct >= 0;
  const card = document.getElementById("hcard-" + sym);
  if (card) {
    const pe = document.getElementById("hp-" + sym);
    if (pe) {
      pe.textContent = fmtPrice(d.price);
      if (prev !== undefined && d.price !== prev) {
        pe.classList.remove("price-up", "price-dn");
        void pe.offsetWidth;
        pe.classList.add(d.price > prev ? "price-up" : "price-dn");
        card.classList.remove("hc-flash-up", "hc-flash-dn");
        void card.offsetWidth;
        card.classList.add(d.price > prev ? "hc-flash-up" : "hc-flash-dn");
      }
    }
    const pp = document.getElementById("hpct-" + sym);
    if (pp) {
      pp.textContent = (isUp ? "+" : "") + d.pct.toFixed(2) + "%";
      pp.style.color = isUp ? "var(--g)" : "var(--r)";
    }
    const hl = document.getElementById("hhl-" + sym);
    if (hl) hl.textContent = "H:" + fmtPrice(d.high) + " L:" + fmtPrice(d.low);
    const sc = skCharts[sym];
    if (sc) {
      sc.data.labels = mini[sym].map(() => "");
      sc.data.datasets[0].data = [...mini[sym]];
      sc.data.datasets[0].borderColor = isUp ? "#00E88A" : "#FF3D60";
      sc.update("none");
    }
  }
  lastP[sym] = d.price;
}

function updateMarquee() {
  const items = COINS.map((c) => {
    const d = liveData[c.s];
    if (!d) return "";
    const isUp = d.pct >= 0;
    const cls = "chg " + (isUp ? "up" : "dn");
    return `<span class="mq-item"><span class="mq-s">${c.t}</span><span class="mq-p">${fmtPrice(d.price)}</span><span class="${cls}" style="font-size:8px;padding:1px 4px;border-radius:3px">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</span></span>`;
  }).join("");
  if (!items) return;
  document.getElementById("mqInner").innerHTML = items + items;
}

let barChartInst = null;
function updateBarChart() {
  if (typeof Chart === "undefined") return;
  const labels = COINS.map((c) => c.t);
  const vals = COINS.map((c) => liveData[c.s]?.pct ?? null);
  const colors = vals.map((v) =>
    v >= 0 ? "rgba(0,232,138,0.72)" : "rgba(255,61,96,0.72)",
  );
  if (barChartInst) {
    barChartInst.data.datasets[0].data = vals;
    barChartInst.data.datasets[0].backgroundColor = colors;
    barChartInst.update("none");
    return;
  }
  barChartInst = new Chart(document.getElementById("barChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: vals,
          backgroundColor: colors,
          borderRadius: 3,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) =>
              (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(2) + "%",
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#8a9fb5",
            font: { size: 10, family: "Space Mono" },
            maxRotation: 0,
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: {
            color: "#8a9fb5",
            font: { size: 10, family: "Space Mono" },
            callback: (v) => v.toFixed(1) + "%",
          },
          grid: { color: "rgba(255,255,255,0.025)" },
          border: { display: false },
        },
      },
    },
  });
}

function updateMarketBreadth() {
  const values = COINS.map(coin => liveData[coin.s]).filter(Boolean);
  const rising = values.filter(d => d.pct > 0).length;
  const falling = values.filter(d => d.pct < 0).length;
  const unchanged = values.length - rising - falling;
  const percentage = values.length ? Math.round(rising / values.length * 100) : 0;
  const color = percentage >= 50 ? "var(--g)" : "var(--r)";
  document.getElementById("breadthNum").textContent = values.length ? percentage + "%" : "—";
  document.getElementById("breadthNum").style.color = color;
  document.getElementById("breadthLbl").textContent = values.length ? `${rising} of ${values.length} gaining` : "Waiting for data";
  document.getElementById("breadthFill").style.width = percentage + "%";
  document.getElementById("breadthFill").style.background = color;
  const progress = document.getElementById("breadthProgress");
  if (values.length) {
    progress.setAttribute("aria-valuenow", percentage);
    progress.setAttribute("aria-valuetext", `${rising} of ${values.length} coins gaining over the last 24 hours`);
  } else {
    progress.removeAttribute("aria-valuenow");
    progress.removeAttribute("aria-valuetext");
  }
  document.getElementById("breadthSummary").textContent = values.length ? `${falling} declining · ${unchanged} unchanged` : "";
  const status = document.getElementById("breadthStatus");
  if (!marketUpdatedAt) {
    status.textContent = connectionState === "offline" ? "Offline · waiting for prices" : "Waiting for prices...";
    return;
  }
  const disconnected = ["offline", "error", "reconnecting", "stale"].includes(connectionState);
  const time = new Date(marketUpdatedAt).toLocaleTimeString("en-US");
  status.textContent = `${disconnected ? "Live updates unavailable · last data" : "Last data"} at ${time}` + (values.length < COINS.length ? ` · ${values.length}/${COINS.length} coins received` : "");
}

function updateHeatmap() {
  replaceWidget("heatmap", COINS.map((coin) => {
    const d = liveData[coin.s];
    if (!d) return "";
    const pct = d.pct;
    const isUp = pct >= 0;
    const intensity = Math.min(Math.abs(pct) / 8, 1);
    const bg = isUp
      ? `rgba(0,232,138,${0.07 + intensity * 0.28})`
      : `rgba(255,61,96,${0.07 + intensity * 0.28})`;
    const tc = isUp
      ? `rgba(0,${Math.round(150 + intensity * 82)},100,1)`
      : `rgba(255,${Math.round(80 - intensity * 50)},80,1)`;
    return `<button type="button" class="hm-c" data-open="${coin.s}" style="background:${bg}" onclick="openModal('${coin.s}')"><div class="hm-s" style="color:${tc};opacity:.8">${coin.t}</div><div class="hm-p" style="color:${tc}">${isUp ? "+" : ""}${pct.toFixed(1)}%</div></button>`;
  }).join(""));
}

async function fetchOrderBook() {
  if (orderBookBusy || !navigator.onLine || document.hidden) return;
  orderBookBusy = true;
  try {
    orderBookData = await CryptoAPI.depth();
    renderOrderBook();
    document.getElementById("orderBookStatus").textContent = "Snapshot · " + new Date().toLocaleTimeString("en-US");
  } catch {
    document.getElementById("orderBookStatus").textContent = orderBookData ? "Outdated data" : "Unavailable";
    if (!orderBookData) document.getElementById("orderBook").textContent = "Unable to load the order book.";
  } finally { orderBookBusy = false; }
}
function renderOrderBook() {
  if (!orderBookData) return;
  const { asks, bids } = orderBookData;
  const maxV = Math.max(...asks.map(a => a.v), ...bids.map(b => b.v), 0.001);
  const rows = (items, up) => items.map(a => `<div class="ob-row"><span class="ob-p" style="color:${up ? "var(--g)" : "var(--r)"}">${fmtPrice(a.p)}</span><div class="ob-bwrap"><div class="ob-b" style="width:${a.v / maxV * 100}%;background:${up ? "var(--g)" : "var(--r)"}"></div></div><span class="ob-v">${a.v.toFixed(3)}</span></div>`).join("");
  document.getElementById("orderBook").innerHTML = rows([...asks].reverse(), false) + `<div class="ob-mid">Spread ${fmtPrice(asks[0].p - bids[0].p)} · quantity in BTC</div>` + rows(bids, true);
}

function renderVolBars() {
  const sorted = COINS.filter(c => liveData[c.s]).map((c) => ({ coin: c, vol: liveData[c.s].vol }))
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 6);
  const max = sorted[0]?.vol || 1;
  document.getElementById("volBars").innerHTML = sorted
    .map(
      ({ coin, vol }) =>
        `<div class="vbr"><span class="vb-s">${coin.t}</span><div class="vb-t"><div class="vb-f" style="width:${Math.round((vol / max) * 100)}%;background:${coin.c}"></div></div><span class="vb-v">${fmtV(vol)}</span></div>`,
    )
    .join("");
}

function renderMovers() {
  const sorted = COINS.map((c) => ({ coin: c, d: liveData[c.s] }))
    .filter((x) => x.d)
    .sort((a, b) => b.d.pct - a.d.pct);
  const mk = (arr) =>
    arr
      .map(({ coin, d }) => {
        const isUp = d.pct >= 0;
        return `<button type="button" class="mv" data-open="${coin.s}" onclick="openModal('${coin.s}')"><div class="mv-l"><div class="mv-ico" style="background:${coin.bg};color:${coin.c}">${coin.i}</div><div><div class="mv-name">${coin.n}</div><div class="mv-sym">${coin.t}</div></div></div><div style="text-align:right"><span class="chg ${isUp ? "up" : "dn"}">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</span><div class="mv-p">${fmtPrice(d.price)}</div></div></button>`;
      })
      .join("");
  if (!sorted.length) {
    document.getElementById("gainers").innerHTML = document.getElementById("losers").innerHTML = '<p class="empty-state">Waiting for prices...</p>';
    return;
  }
  replaceWidget("gainers", mk(sorted.filter(x => x.d.pct > 0).slice(0, 3)) || '<p class="empty-state">No coins with gains.</p>');
  replaceWidget("losers", mk(sorted.filter(x => x.d.pct < 0).slice(-3).reverse()) || '<p class="empty-state">No coins with losses.</p>');
}

function sortBy(col) {
  if (sortState.col === col) sortState.dir *= -1;
  else {
    sortState.col = col;
    sortState.dir = 1;
  }
  document
    .querySelectorAll("thead th")
    .forEach((th) => th.classList.remove("sorted"));
  const el = document.getElementById("th-" + col);
  document.querySelectorAll("thead th").forEach(th => th.removeAttribute("aria-sort"));
  if (el) { el.classList.add("sorted"); el.setAttribute("aria-sort", sortState.dir === 1 ? "ascending" : "descending"); }
  renderTable();
}
function setTab(idx, el) {
  currentTab = idx;
  if (idx === 1 || idx === 2) {
    sortState = { col: "rank", dir: 1 };
    document.querySelectorAll("thead th").forEach(th => { th.classList.remove("sorted"); th.removeAttribute("aria-sort"); });
  }
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-pressed", t === el));
  renderTable();
}
function toggleFavsOnly() {
  favsOnly = !favsOnly;
  const btn = document.getElementById("favBtn");
  btn.classList.toggle("active", favsOnly);
  btn.setAttribute("aria-pressed", favsOnly);
  renderTable();
}
function toggleFav(sym) {
  if (!getCoin(sym)) return;
  if (favs.has(sym)) favs.delete(sym);
  else favs.add(sym);
  savePreferences();
  const btn = document.getElementById("modalFavBtn");
  if (btn) { btn.style.color = favs.has(sym) ? "var(--y)" : "var(--t3)"; btn.setAttribute("aria-pressed", favs.has(sym)); btn.textContent = favs.has(sym) ? "★" : "☆"; }
  renderTable();
}

function renderTable() {
  const focused = document.activeElement;
  const focusSymbol = document.getElementById("tableBody").contains(focused) ? focused?.dataset?.fav || focused?.dataset?.open : null;
  const focusType = focused?.dataset?.fav ? "fav" : "open";
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  let rows = COINS.map((c) => ({ coin: c, d: liveData[c.s] })).filter(
    (x) => x.d,
  );
  if (q)
    rows = rows.filter(
      ({ coin }) =>
        coin.n.toLowerCase().includes(q) || coin.t.toLowerCase().includes(q),
    );
  if (currentTab === 1) rows = rows.filter(x => x.d.pct > 0).sort((a, b) => b.d.pct - a.d.pct);
  else if (currentTab === 2) rows = rows.filter(x => x.d.pct < 0).sort((a, b) => a.d.pct - b.d.pct);
  else if (currentTab === 3) rows = rows.filter(({ coin }) => favs.has(coin.s));
  if (favsOnly) rows = rows.filter(({ coin }) => favs.has(coin.s));
  if (sortState.col !== "rank") {
    rows.sort((a, b) => {
      let av, bv;
      if (sortState.col === "price") {
        av = a.d.price;
        bv = b.d.price;
      } else if (sortState.col === "pct") {
        av = a.d.pct;
        bv = b.d.pct;
      } else if (sortState.col === "vol") {
        av = a.d.vol;
        bv = b.d.vol;
      } else if (sortState.col === "hl") {
        av = a.d.high - a.d.low;
        bv = b.d.high - b.d.low;
      }
      return (av - bv) * sortState.dir;
    });
  }
  const tbody = document.getElementById("tableBody");
  const previousRows = new Map([...tbody.querySelectorAll("tr[data-sym]")].map(tr => [tr.dataset.sym, tr]));
  const fragment = document.createDocumentFragment();
  if (!rows.length) {
    if (focusSymbol) document.getElementById("searchInput").focus({ preventScroll: true });
    const message = !Object.keys(liveData).length ? "Waiting for prices..." : currentTab === 3 || favsOnly ? "No favorites in this selection. Use the star next to a coin." : "No coins found in this selection.";
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${message}</td></tr>`;
    return;
  }
  rows.forEach(({ coin, d }, idx) => {
    const isUp = d.pct >= 0;
    const bars = mini[coin.s] || [];
    const minB = Math.min(...bars),
      maxB = Math.max(...bars),
      range = maxB - minB || 1;
    const barsHtml = bars
      .map((b) => {
        const h = Math.round(2 + ((b - minB) / range) * 18);
        const op = (0.3 + ((b - minB) / range) * 0.7).toFixed(2);
        return `<div class="cbar" style="height:${h}px;background:${isUp ? "#00E88A" : "#FF3D60"};opacity:${op}"></div>`;
      })
      .join("");
    const altPrice =
      currency === "USDT" ? fmtBRL(d.price, brlRate) : fmtUSDT(d.price);
    const tr = previousRows.get(coin.s) || document.createElement("tr");
    tr.dataset.sym = coin.s;
    tr.innerHTML = `<td><span class="rank">${idx + 1}</span></td>
<td><div class="crow"><button type="button" class="row-fav" aria-label="${favs.has(coin.s) ? "Remove from favorites:" : "Favorite"} ${coin.n}" aria-pressed="${favs.has(coin.s)}" data-fav="${coin.s}">${favs.has(coin.s) ? "★" : "☆"}</button><div class="cico" style="background:${coin.bg};color:${coin.c}">${coin.i}</div><button type="button" class="coin-open" data-open="${coin.s}"><span class="cname">${coin.n}</span><span class="csym">${coin.t}</span></button></div></td>
<td class="r"><div class="ptd">${fmtPrice(d.price)}</div><div class="ptd-sub">${altPrice}</div></td>
<td class="r"><span class="chg ${isUp ? "up" : "dn"}">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</span></td>
<td class="r"><span class="vl">${fmtV(d.vol)}</span></td>
<td class="r"><span style="color:var(--g);font-size:9px;font-family:'Space Mono',monospace">${fmtPrice(d.high)}</span><br><span style="color:var(--r);font-size:9px;font-family:'Space Mono',monospace">${fmtPrice(d.low)}</span></td>
<td class="r"><div class="candles">${barsHtml}</div></td>`;
    tr.querySelector("[data-fav]").addEventListener("click", event => { event.stopPropagation(); toggleFav(coin.s); });
    tr.onclick = () => openModal(coin.s);
    fragment.appendChild(tr);
  });
  tbody.replaceChildren(fragment);
  if (focusSymbol) {
    const target = tbody.querySelector(`[data-${focusType}="${focusSymbol}"]`);
    if (target) target.focus({ preventScroll: true });
    else document.getElementById("searchInput").focus({ preventScroll: true });
  }
}

function renderAll() {
  updateMarketBreadth();
  renderTable();
  updateMarquee();
  updateBarChart();
  updateHeatmap();
  renderOrderBook();
  renderVolBars();
  renderMovers();
  COINS.slice(0, 5).forEach((c) => updateCoinUI(c.s));
}

function openModal(sym) {
  const coin = getCoin(sym);
  const d = liveData[sym];
  if (!d) return;
  currentModal = sym;
  modalTrigger = document.activeElement;
  document.getElementById("modalTitle").innerHTML =
    `<div class="cico" style="background:${coin.bg};color:${coin.c};width:30px;height:30px">${coin.i}</div><div><div style="font-size:14px;font-weight:800;color:var(--t1)">${coin.n}</div><div style="font-size:9px;color:var(--t3);font-family:'Space Mono',monospace">${coin.t}/USDT</div></div>`;
  updateModal(sym);
  document.getElementById("modalFavBtn").style.color = favs.has(sym)
    ? "var(--y)"
    : "var(--t3)";
  document.getElementById("modalFavBtn").setAttribute("aria-pressed", favs.has(sym));
  document.getElementById("modalFavBtn").textContent = favs.has(sym) ? "★" : "☆";
  document.getElementById("calcSym").textContent = coin.t + " =";
  document.getElementById("calcInput").value = "1";
  calcConvert();
  document.getElementById("modalOverlay").showModal();
  document.body.style.overflow = "hidden";
  document.querySelector(".modal-close").focus();
  document
    .querySelectorAll(".tf-btn")
    .forEach((b, i) => b.classList.toggle("active", i === 0));
  loadKlines("1h", "1d", null);
}

function updateModal(sym) {
  const d = liveData[sym];
  if (!d) return;
  const isUp = d.pct >= 0;
  document.getElementById("modalStats").innerHTML = `
    <div class="ms"><div class="ms-l">USDT price</div><div class="ms-v">${fmtUSDT(d.price)}</div><div class="ms-sub" style="color:var(--y)">${fmtBRL(d.price, brlRate)}</div></div>
    <div class="ms"><div class="ms-l">24h %</div><div class="ms-v" style="color:${isUp ? "var(--g)" : "var(--r)"}">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</div></div>
    <div class="ms"><div class="ms-l">24h high</div><div class="ms-v" style="color:var(--g)">${fmtUSDT(d.high)}</div></div>
    <div class="ms"><div class="ms-l">24h low</div><div class="ms-v" style="color:var(--r)">${fmtUSDT(d.low)}</div></div>`;
  calcConvert();
}

function calcConvert() {
  const sym = currentModal;
  if (!sym) return;
  const d = liveData[sym];
  if (!d) return;
  const input = document.getElementById("calcInput");
  const qty = Number(input.value);
  const valid = Number.isFinite(qty) && Number.isFinite(qty * d.price) && (!Number.isFinite(brlRate) || Number.isFinite(qty * d.price * brlRate)) && qty >= 0 && input.value !== "";
  input.setAttribute("aria-invalid", !valid);
  if (!valid) {
    document.getElementById("calcResultUSDT").textContent = "Invalid quantity";
    document.getElementById("calcResultBRL").textContent = "—";
    return;
  }
  const usd = qty * d.price;
  const brl = Number.isFinite(brlRate) ? usd * brlRate : null;
  document.getElementById("calcResultUSDT").textContent =
    "₮" +
    usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  document.getElementById("calcResultBRL").textContent =
    brl === null ? "Unavailable" : "R$" +
      brl.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

async function loadKlines(interval, range, btnEl) {
  chartController?.abort();
  chartController = new AbortController();
  const requestID = ++chartRequest;
  if (modalChartInst) { modalChartInst.destroy(); modalChartInst = null; }
  document.getElementById("chartStatus").textContent = "Loading history...";
  if (btnEl) {
    document
      .querySelectorAll(".tf-btn")
      .forEach((b) => b.classList.remove("active"));
    btnEl.classList.add("active");
  }
  const sym = currentModal;
  if (!sym) return;
  const coin = getCoin(sym);
  const limitMap = { "1d": 24, "7d": 42, "30d": 30 };
  const limit = limitMap[range] || 24;
  try {
    const key = `${sym}:${interval}:${limit}`;
    let raw = historyCache.get(key);
    if (!raw || Date.now() - raw.at > 60000) {
      raw = { at: Date.now(), data: await CryptoAPI.klines(sym, interval, limit, chartController.signal) };
      historyCache.set(key, raw);
    }
    if (requestID !== chartRequest || currentModal !== sym) return;
    const labels = raw.data.map(k => {
      const dt = new Date(k.time);
      return interval === "1d" ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : dt.toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    });
    const closes = raw.data.map(k => k.close);
    document.getElementById("chartStatus").textContent = "";
    if (typeof Chart === "undefined") throw new Error("Chart library is unavailable.");
    const isUp = closes[closes.length - 1] >= closes[0];
    if (modalChartInst) {
      modalChartInst.destroy();
      modalChartInst = null;
    }
    modalChartInst = new Chart(document.getElementById("modalChart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: closes,
            borderColor: isUp ? "#00E88A" : "#FF3D60",
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) =>
                "₮" +
                c.parsed.y.toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                }),
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#8a9fb5",
              font: { size: 10, family: "Space Mono" },
              maxTicksLimit: 8,
              maxRotation: 0,
            },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: {
              color: "#8a9fb5",
              font: { size: 10, family: "Space Mono" },
              callback: (v) =>
                v >= 1000
                  ? "₮" + (v / 1000).toFixed(1) + "k"
                  : "₮" + v.toFixed(2),
            },
            grid: { color: "rgba(255,255,255,0.025)" },
            border: { display: false },
          },
        },
      },
    });
    document.getElementById("modalChartLabel").textContent =
      `${coin.t}/USDT · ${range.toUpperCase()} · ${interval.toUpperCase()}`;
  } catch (error) {
    if (requestID === chartRequest && currentModal === sym) document.getElementById("chartStatus").textContent = "History is unavailable. Select a time range to try again.";
  }
}

function closeModal() {
  chartController?.abort();
  chartRequest++;
  document.getElementById("modalOverlay").close();
  document.body.style.overflow = "";
  if (modalChartInst) { modalChartInst.destroy(); modalChartInst = null; }
  currentModal = null;
  if (modalTrigger?.isConnected) modalTrigger.focus();
  else document.getElementById("searchInput").focus();
}

const dialog = document.getElementById("modalOverlay");
dialog.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });
dialog.addEventListener("click", event => { if (event.target === dialog) closeModal(); });
document.querySelectorAll("thead th[onclick]").forEach(th => {
  const action = th.getAttribute("onclick");
  th.removeAttribute("onclick");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = th.textContent;
  button.addEventListener("click", () => sortBy(action.match(/'([^']+)'/)[1]));
  th.replaceChildren(button);
});
document.getElementById("retryBtn").addEventListener("click", () => { reconnectAttempt = 0; connectWS(); fetchInitial(); fetchBRL(); fetchOrderBook(); });
window.addEventListener("offline", () => {
  clearTimeout(wsReconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); }
  setWsStatus("offline", "Offline");
  announce("You are offline. Displayed data may be outdated.");
});
window.addEventListener("online", () => { reconnectAttempt = 0; connectWS(); fetchInitial(); fetchBRL(); fetchOrderBook(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    if (!ws || ws.readyState > 1 || Date.now() - lastMessageTime > 20000) connectWS();
    fetchBRL(); fetchOrderBook();
  }
});
window.addEventListener("pagehide", () => {
  stopped = true;
  clearTimeout(wsReconnectTimer);
  chartController?.abort();
  if (ws) { ws.onclose = null; ws.close(); }
});
window.addEventListener("pageshow", event => { if (event.persisted) { stopped = false; connectWS(); fetchBRL(); fetchOrderBook(); } });

initHero();
setCurrency(currency);
fetchBRL();
fetchInitial();
connectWS();
fetchOrderBook();
setInterval(() => { if (!stopped && !document.hidden) fetchBRL(); }, 60000);
setInterval(() => { if (!stopped) fetchOrderBook(); }, 15000);
setInterval(() => {
  if (stopped || document.hidden || !navigator.onLine) return;
  if (ws && ws.readyState < 2 && Date.now() - lastMessageTime > 20000) {
    setWsStatus("stale", "Outdated data");
    announce("The stream stopped updating. Trying to reconnect.");
    connectWS();
  }
  if (connectionState !== "live") fetchInitial();
}, 10000);
