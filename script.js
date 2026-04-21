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
    t: "X",
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

const fmtUSD = (p) => {
  p = parseFloat(p);
  if (p >= 1000)
    return (
      "$" +
      p.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  if (p >= 1) return "$" + p.toFixed(4);
  return "$" + p.toFixed(6);
};
const fmtBRL = (p, r) => {
  const v = parseFloat(p) * r;
  if (v >= 1000)
    return (
      "R$" +
      v.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  return "R$" + v.toFixed(4);
};
const fmtV = (v) => {
  v = parseFloat(v);
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + (v / 1e3).toFixed(0) + "K";
};

let liveData = {};
let lastP = {};
let mini = {};
let brlRate = 5.8;
let currency = "USD";
let favs = new Set();
let favsOnly = false;
let currentTab = 0;
let sortState = { col: "rank", dir: 1 };
let currentModal = null;
let modalChartInst = null;
let ws = null;
let wsReconnectTimer = null;
let tickCount = 0;
let lastTickTime = Date.now();

COINS.forEach((c) => {
  mini[c.s] = Array.from({ length: 16 }, () => 50 + Math.random() * 50);
});

const fmtPrice = (p) => (currency === "BRL" ? fmtBRL(p, brlRate) : fmtUSD(p));
const fmtSym = () => (currency === "BRL" ? "R$" : "$");

function setCurrency(cur) {
  currency = cur;
  document.getElementById("btnUSD").classList.toggle("active", cur === "USD");
  document.getElementById("btnBRL").classList.toggle("active", cur === "BRL");
  renderAll();
}

async function fetchBRL() {
  try {
    const r = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL",
    );
    const d = await r.json();
    brlRate = parseFloat(d.price) || 5.8;
    document.getElementById("brlRate").textContent =
      "USD/BRL R$" + brlRate.toFixed(2);
  } catch (e) {}
}

async function fetchInitial() {
  try {
    const syms = COINS.map((c) => `"${c.s}"`).join(",");
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=[${syms}]`,
    );
    const data = await r.json();
    data.forEach((d) => {
      liveData[d.symbol] = {
        price: parseFloat(d.lastPrice),
        pct: parseFloat(d.priceChangePercent),
        vol: parseFloat(d.quoteVolume),
        high: parseFloat(d.highPrice),
        low: parseFloat(d.lowPrice),
        change: parseFloat(d.priceChange),
      };
      mini[d.symbol].push(parseFloat(d.lastPrice));
      mini[d.symbol] = mini[d.symbol].slice(-16);
    });
    renderAll();
    updateFear();
  } catch (e) {
    console.error("Initial fetch failed", e);
  }
}

function connectWS() {
  const streams = COINS.map((c) => c.s.toLowerCase() + "@ticker").join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
  }
  ws = new WebSocket(url);

  ws.onopen = () => {
    setWsStatus("live", "WebSocket · ao vivo");
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const d = msg.data;
      if (!d || !d.s) return;
      const sym = d.s;
      const price = parseFloat(d.c);
      const prev = liveData[sym]?.price;
      liveData[sym] = {
        price,
        pct: parseFloat(d.P),
        vol: parseFloat(d.q),
        high: parseFloat(d.h),
        low: parseFloat(d.l),
        change: parseFloat(d.p),
      };
      mini[sym].push(price);
      mini[sym] = mini[sym].slice(-16);
      tickCount++;
      const now = Date.now();
      if (now - lastTickTime > 200) {
        lastTickTime = now;
        const el = document.getElementById("tickCounter");
        if (el) el.textContent = `${tickCount} ticks`;
      }
      onPriceUpdate(sym, price, prev);
    } catch (err) {}
  };

  ws.onerror = () => {
    setWsStatus("error", "Erro no WS");
  };

  ws.onclose = () => {
    setWsStatus("reconnecting", "Reconectando...");
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };
}

function setWsStatus(state, label) {
  const pill = document.getElementById("wsPill");
  const dot = document.getElementById("wsDot");
  const lbl = document.getElementById("wsLabel");
  const sdot = document.getElementById("wsStatusDot");
  const slbl = document.getElementById("wsStatusLabel");
  pill.className =
    "pill p-ws" +
    (state === "live" ? " connected" : state === "error" ? " error" : "");
  dot.style.background =
    state === "live" ? "var(--g)" : state === "error" ? "var(--r)" : "var(--y)";
  if (lbl)
    lbl.textContent =
      state === "live"
        ? "WebSocket · live"
        : state === "error"
          ? "Erro"
          : label;
  if (sdot) {
    sdot.className =
      "ws-dot" +
      (state === "live" ? " live" : state === "error" ? " error" : "");
  }
  if (slbl)
    slbl.textContent =
      state === "live"
        ? "Tempo real · ~1s"
        : state === "error"
          ? "Erro de conexão"
          : "Reconectando...";
}

const pendingUpdates = new Set();
let rafScheduled = false;
function onPriceUpdate(sym, price, prev) {
  pendingUpdates.add(sym);
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushUpdates);
  }
}

function flushUpdates() {
  rafScheduled = false;
  const syms = [...pendingUpdates];
  pendingUpdates.clear();
  syms.forEach((sym) => updateCoinUI(sym));
  updateBarChart();
  updateMarquee();
  updateHeatmap();
  renderMovers();
  renderVolBars();
  if (currentModal && syms.includes(currentModal)) updateModal(currentModal);
  document.getElementById("footerTs").textContent =
    "Atualizado " + new Date().toLocaleTimeString("pt-BR");
}

const skCharts = {};
function initHero() {
  const hg = document.getElementById("heroGrid");
  hg.innerHTML = COINS.slice(0, 5)
    .map(
      (coin) => `
    <div class="hcard" id="hcard-${coin.s}" onclick="openModal('${coin.s}')">
      <div class="hc-s">${coin.t}/USDT</div>
      <div class="hc-p" id="hp-${coin.s}">—</div>
      <div class="hc-pct" id="hpct-${coin.s}">—</div>
      <div class="hc-hl" id="hhl-${coin.s}">H:— L:—</div>
      <canvas class="hc-spark" id="hsk-${coin.s}" role="img" aria-label="${coin.t} sparkline"></canvas>
    </div>`,
    )
    .join("");
  COINS.slice(0, 5).forEach((coin) => {
    const cv = document.getElementById("hsk-" + coin.s);
    if (!cv) return;
    skCharts[coin.s] = new Chart(cv, {
      type: "line",
      data: {
        labels: Array(16).fill(""),
        datasets: [
          {
            data: Array(16).fill(50),
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
      sc.data.datasets[0].data = [...mini[sym]];
      sc.data.datasets[0].borderColor = isUp ? "#00E88A" : "#FF3D60";
      sc.update("none");
    }
  }
  const tr = document.querySelector(`tr[data-sym="${sym}"]`);
  if (tr) {
    const ptdEl = tr.querySelector(".ptd");
    if (ptdEl) {
      ptdEl.textContent = fmtPrice(d.price);
      const sub = tr.querySelector(".ptd-sub");
      if (sub)
        sub.textContent =
          currency === "USD" ? fmtBRL(d.price, brlRate) : fmtUSD(d.price);
      if (prev !== undefined && d.price !== prev) {
        ptdEl.classList.remove("price-up", "price-dn");
        void ptdEl.offsetWidth;
        ptdEl.classList.add(d.price > prev ? "price-up" : "price-dn");
        tr.classList.remove("flash-up", "flash-dn");
        void tr.offsetWidth;
        tr.classList.add(d.price > prev ? "flash-up" : "flash-dn");
      }
    }
    const chgEl = tr.querySelector(".chg");
    if (chgEl) {
      chgEl.textContent = (isUp ? "+" : "") + d.pct.toFixed(2) + "%";
      chgEl.className = "chg " + (isUp ? "up" : "dn");
    }
    const hlEl = tr.querySelectorAll("td")[5];
    if (hlEl)
      hlEl.innerHTML = `<span style="color:var(--g);font-size:9px;font-family:'Space Mono',monospace">${fmtPrice(d.high)}</span><br><span style="color:var(--r);font-size:9px;font-family:'Space Mono',monospace">${fmtPrice(d.low)}</span>`;
    const barsEl = tr.querySelector(".candles");
    if (barsEl) {
      const bars = mini[sym] || [];
      const minB = Math.min(...bars),
        maxB = Math.max(...bars),
        range = maxB - minB || 1;
      barsEl.innerHTML = bars
        .map((b) => {
          const h = Math.round(2 + ((b - minB) / range) * 18);
          const op = (0.3 + ((b - minB) / range) * 0.7).toFixed(2);
          return `<div class="cbar" style="height:${h}px;background:${isUp ? "#00E88A" : "#FF3D60"};opacity:${op}"></div>`;
        })
        .join("");
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
  document.getElementById("mqInner").innerHTML = items + items;
}

let barChartInst = null;
function updateBarChart() {
  const labels = COINS.map((c) => c.t);
  const vals = COINS.map((c) => liveData[c.s]?.pct || 0);
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
            color: "#1A2E40",
            font: { size: 8, family: "Space Mono" },
            maxRotation: 0,
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: {
            color: "#1A2E40",
            font: { size: 8, family: "Space Mono" },
            callback: (v) => v.toFixed(1) + "%",
          },
          grid: { color: "rgba(255,255,255,0.025)" },
          border: { display: false },
        },
      },
    },
  });
}

function updateFear() {
  const v = Math.round(22 + Math.random() * 60);
  let lbl, col;
  if (v <= 20) {
    lbl = "Medo Extremo";
    col = "#FF3D60";
  } else if (v <= 40) {
    lbl = "Medo";
    col = "#FF7840";
  } else if (v <= 60) {
    lbl = "Neutro";
    col = "#F3BA2F";
  } else if (v <= 80) {
    lbl = "Ganância";
    col = "#00C870";
  } else {
    lbl = "Ganância Extrema";
    col = "#00FFB2";
  }
  document.getElementById("fearNum").textContent = v;
  document.getElementById("fearNum").style.color = col;
  document.getElementById("fearLbl").textContent = lbl;
  document.getElementById("fearLbl").style.color = col;
  document.getElementById("fearFill").style.width = v + "%";
  document.getElementById("fearFill").style.background = col;
}

function updateHeatmap() {
  document.getElementById("heatmap").innerHTML = COINS.map((coin) => {
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
    return `<div class="hm-c" style="background:${bg}" onclick="openModal('${coin.s}')"><div class="hm-s" style="color:${tc};opacity:.8">${coin.t}</div><div class="hm-p" style="color:${tc}">${isUp ? "+" : ""}${pct.toFixed(1)}%</div></div>`;
  }).join("");
}

function renderOrderBook(price) {
  const p = parseFloat(price) || 95000;
  const spread = (p * 0.00018).toFixed(2);
  const asks = Array.from({ length: 5 }, (_, i) => ({
    p: (p + (i + 1) * p * 0.00025).toFixed(0),
    v: (0.5 + Math.random() * 3.5).toFixed(3),
  }));
  const bids = Array.from({ length: 5 }, (_, i) => ({
    p: (p - (i + 1) * p * 0.00025).toFixed(0),
    v: (0.5 + Math.random() * 3.5).toFixed(3),
  }));
  const maxV = Math.max(
    ...asks.map((a) => parseFloat(a.v)),
    ...bids.map((b) => parseFloat(b.v)),
  );
  document.getElementById("orderBook").innerHTML =
    asks
      .reverse()
      .map(
        (a) =>
          `<div class="ob-row"><span class="ob-p" style="color:#FF3D60">${parseFloat(a.p).toLocaleString()}</span><div class="ob-bwrap"><div class="ob-b" style="width:${(parseFloat(a.v) / maxV) * 100}%;background:rgba(255,61,96,0.22)"></div></div><span class="ob-v">${a.v}</span></div>`,
      )
      .join("") +
    `<div class="ob-mid">spread $${spread}</div>` +
    bids
      .map(
        (b) =>
          `<div class="ob-row"><span class="ob-p" style="color:#00E88A">${parseFloat(b.p).toLocaleString()}</span><div class="ob-bwrap"><div class="ob-b" style="width:${(parseFloat(b.v) / maxV) * 100}%;background:rgba(0,232,138,0.18)"></div></div><span class="ob-v">${b.v}</span></div>`,
      )
      .join("");
}

function renderVolBars() {
  const sorted = COINS.map((c) => ({ coin: c, vol: liveData[c.s]?.vol || 0 }))
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
        return `<div class="mv" onclick="openModal('${coin.s}')"><div class="mv-l"><div class="mv-ico" style="background:${coin.bg};color:${coin.c}">${coin.i}</div><div><div class="mv-name">${coin.n}</div><div class="mv-sym">${coin.t}</div></div></div><div style="text-align:right"><span class="chg ${isUp ? "up" : "dn"}">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</span><div class="mv-p">${fmtPrice(d.price)}</div></div></div>`;
      })
      .join("");
  document.getElementById("gainers").innerHTML = mk(sorted.slice(0, 3));
  document.getElementById("losers").innerHTML = mk(sorted.slice(-3).reverse());
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
  if (el) el.classList.add("sorted");
  renderTable();
}
function setTab(idx, el) {
  currentTab = idx;
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  renderTable();
}
function toggleFavsOnly() {
  favsOnly = !favsOnly;
  const btn = document.getElementById("favBtn");
  btn.classList.toggle("active", favsOnly);
  renderTable();
}
function toggleFav(sym) {
  if (!sym) return;
  if (favs.has(sym)) favs.delete(sym);
  else favs.add(sym);
  const btn = document.getElementById("modalFavBtn");
  if (btn) btn.style.color = favs.has(sym) ? "var(--y)" : "var(--t3)";
  renderTable();
}

function renderTable() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  let rows = COINS.map((c) => ({ coin: c, d: liveData[c.s] })).filter(
    (x) => x.d,
  );
  if (q)
    rows = rows.filter(
      ({ coin }) =>
        coin.n.toLowerCase().includes(q) || coin.t.toLowerCase().includes(q),
    );
  if (currentTab === 1) rows.sort((a, b) => b.d.pct - a.d.pct);
  else if (currentTab === 2) rows.sort((a, b) => a.d.pct - b.d.pct);
  else if (currentTab === 3) rows = rows.filter(({ coin }) => favs.has(coin.s));
  if (favsOnly) rows = rows.filter(({ coin }) => favs.has(coin.s));
  if (sortState.col !== "rank" && currentTab === 0) {
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
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--t4);font-family:Space Mono,monospace;font-size:10px">Nenhuma moeda encontrada</td></tr>';
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
      currency === "USD" ? fmtBRL(d.price, brlRate) : fmtUSD(d.price);
    const tr = document.createElement("tr");
    tr.dataset.sym = coin.s;
    tr.innerHTML = `<td><span class="rank">${idx + 1}</span></td>
<td><div class="crow"><div class="cico" style="background:${coin.bg};color:${coin.c}">${coin.i}</div><div><div class="cname">${coin.n}</div><div class="csym">${coin.t}</div></div></div></td>
<td class="r"><div class="ptd">${fmtPrice(d.price)}</div><div class="ptd-sub">${altPrice}</div></td>
<td class="r"><span class="chg ${isUp ? "up" : "dn"}">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</span></td>
<td class="r"><span class="vl">${fmtV(d.vol)}</span></td>
<td class="r"><span style="color:var(--g);font-size:9px;font-family:'Space Mono',monospace">${fmtPrice(d.high)}</span><br><span style="color:var(--r);font-size:9px;font-family:'Space Mono',monospace">${fmtPrice(d.low)}</span></td>
<td class="r"><div class="candles">${barsHtml}</div></td>`;
    tr.addEventListener("click", () => openModal(coin.s));
    tbody.appendChild(tr);
    lastP[coin.s] = d.price;
  });
}

function renderAll() {
  renderTable();
  updateMarquee();
  updateBarChart();
  updateHeatmap();
  renderOrderBook(liveData["BTCUSDT"]?.price);
  renderVolBars();
  renderMovers();
  COINS.slice(0, 5).forEach((c) => updateCoinUI(c.s));
}

function openModal(sym) {
  currentModal = sym;
  const coin = getCoin(sym);
  const d = liveData[sym];
  if (!d) return;
  const isUp = d.pct >= 0;
  document.getElementById("modalTitle").innerHTML =
    `<div class="cico" style="background:${coin.bg};color:${coin.c};width:30px;height:30px">${coin.i}</div><div><div style="font-size:14px;font-weight:800;color:var(--t1)">${coin.n}</div><div style="font-size:9px;color:var(--t3);font-family:'Space Mono',monospace">${coin.t}/USDT</div></div>`;
  updateModal(sym);
  document.getElementById("modalFavBtn").style.color = favs.has(sym)
    ? "var(--y)"
    : "var(--t3)";
  document.getElementById("calcSym").textContent = coin.t + " =";
  document.getElementById("calcInput").value = "1";
  calcConvert();
  document.getElementById("modalOverlay").style.display = "flex";
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
    <div class="ms"><div class="ms-l">Preço USD</div><div class="ms-v">${fmtUSD(d.price)}</div><div class="ms-sub" style="color:var(--y)">${fmtBRL(d.price, brlRate)}</div></div>
    <div class="ms"><div class="ms-l">24h %</div><div class="ms-v" style="color:${isUp ? "var(--g)" : "var(--r)"}">${isUp ? "+" : ""}${d.pct.toFixed(2)}%</div></div>
    <div class="ms"><div class="ms-l">High 24h</div><div class="ms-v" style="color:var(--g)">${fmtUSD(d.high)}</div></div>
    <div class="ms"><div class="ms-l">Low 24h</div><div class="ms-v" style="color:var(--r)">${fmtUSD(d.low)}</div></div>`;
  calcConvert();
}

function calcConvert() {
  const sym = currentModal;
  if (!sym) return;
  const d = liveData[sym];
  if (!d) return;
  const qty = parseFloat(document.getElementById("calcInput").value) || 0;
  const usd = qty * d.price;
  const brl = usd * brlRate;
  document.getElementById("calcResultUSD").textContent =
    "$" +
    usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  document.getElementById("calcResultBRL").textContent =
    "R$" +
    brl.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
}

async function loadKlines(interval, range, btnEl) {
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
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`,
    );
    const raw = await r.json();
    const labels = raw.map((k) => {
      const dt = new Date(k[0]);
      return interval === "1d"
        ? dt.toLocaleDateString("pt-BR", { month: "short", day: "numeric" })
        : dt.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          });
    });
    const closes = raw.map((k) => parseFloat(k[4]));
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
                "$" +
                c.parsed.y.toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                }),
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#1A2E40",
              font: { size: 8, family: "Space Mono" },
              maxTicksLimit: 8,
              maxRotation: 0,
            },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: {
              color: "#1A2E40",
              font: { size: 8, family: "Space Mono" },
              callback: (v) =>
                v >= 1000
                  ? "$" + (v / 1000).toFixed(1) + "k"
                  : "$" + v.toFixed(2),
            },
            grid: { color: "rgba(255,255,255,0.025)" },
            border: { display: false },
          },
        },
      },
    });
    document.getElementById("modalChartLabel").textContent =
      `${coin.t} · ${range.toUpperCase()} · ${interval.toUpperCase()}`;
  } catch (e) {}
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  if (modalChartInst) {
    modalChartInst.destroy();
    modalChartInst = null;
  }
  currentModal = null;
}

initHero();
fetchBRL();
fetchInitial().then(() => {
  connectWS();
});
setInterval(fetchBRL, 60000);
setInterval(() => {
  renderOrderBook(liveData["BTCUSDT"]?.price);
}, 3000);
setInterval(updateFear, 30000);
