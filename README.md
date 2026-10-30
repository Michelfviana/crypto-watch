# CryptoWatch

A cryptocurrency dashboard built with HTML, CSS, and JavaScript. No framework, backend, or build step required.

**Demo:** [michelfviana.github.io/crypto-watch](https://michelfviana.github.io/crypto-watch/)

![CryptoWatch](image.png)

> The screenshot shows the original version. The live demo is updated through the repository's deployment workflow.

## Features

- Live prices and 24-hour statistics for ten coins through Binance WebSocket streams.
- Prices in USDT and BRL conversion using the USDT/BRL pair.
- Search, sorting, gainers/losers filters, and favorites saved in your browser.
- Sparklines showing the latest 16 real price updates received during the session.
- Closing-price history for 1, 7, and 30 days, with short-lived caching and cancellation when switching time ranges.
- A five-level BTC/USDT order book snapshot refreshed every 15 seconds while the page is visible.
- A heatmap, trading volumes, and the percentage of tracked coins with positive 24-hour changes.
- A quantity converter, responsive layout, and keyboard-accessible controls.
- Progressive reconnection, offline and stale-data indicators, a reconnect button, and HTTP error and rate-limit handling.

Market values are never randomly generated. The previous simulated Fear & Greed widget has been replaced with **Coins gaining**, calculated from the tracked prices. It is not a market-wide sentiment index. With all ten coins loaded, it changes in steps of 10 percentage points when a coin crosses 0% in its 24-hour change; prices can move without changing this percentage. The card shows when the latest data arrived and warns when live updates are unavailable. Trend bars represent session price samples, not OHLC candles.

## Run locally

Clone the repository and serve the files with any static HTTP server:

```bash
git clone https://github.com/Michelfviana/crypto-watch.git
cd crypto-watch
python3 -m http.server 8080
```

Open `http://localhost:8080`. You do not need to install npm packages to use the dashboard. Opening `index.html` directly also works in browsers that allow external connections, but a local server provides more predictable storage and network behavior.

Chart.js 4.4.1 is included in `vendor/` with its MIT license. Fonts are loaded from Google Fonts, with local fallbacks. If charts cannot load, the price table and other market data remain available.

## Project structure

| File | Responsibility |
| --- | --- |
| `index.html` | Page structure, controls, and details dialog |
| `style.css` | Theme, responsive layouts, and reduced motion |
| `api.js` | Data access, timeouts, validation, and HTTP rate limits |
| `preferences.js` | Local preferences and storage failure recovery |
| `script.js` | State, connection management, rendering, and interactions |
| `tests/` | HTTP integration, validation, and Chromium interaction checks |
| `docs/data-contract.md` | Data sources, contracts, and limitations |

## Verification

With Node.js 22 or later:

```bash
npm run check
npm test
```

To check interface flows, install Chromium and run:

```bash
npm run test:browser
```

To use another compatible executable, set `CHROME_BIN=/path/to/chromium npm run test:browser`.

Browser checks run the actual app and bundled Chart.js against a local HTTP API stand-in and a controlled WebSocket. They cover live updates, rankings, focus, favorites, currency persistence, delayed responses, Escape, HTTP failures, reconnection, market breadth, and 320/390 px screens. They do not depend on Binance availability or establish regional access or CORS support for the real API. Verification screenshots are saved in the system's temporary directory.

## Data and privacy

- USDT is not USD. BRL conversion uses Binance's USDT/BRL price without fees or execution spread. The interface uses English labels and US English number/date formatting, including for BRL amounts.
- Without a valid exchange rate, BRL values are unavailable. An older order book snapshot is marked as outdated if refreshing it fails.
- The connection status becomes “Live” only after a valid market message arrives. More than 20 seconds without updates triggers connection recovery.
- Gainers and losers cover only the ten coins configured in `COINS`, not the entire market. Volume is trading volume quoted in USDT.
- Favorites and the selected currency are saved only in `localStorage`. If storage is blocked, they still work during the session.
- No API key, account, database, or trading endpoint is used. Your browser connects directly to Binance, which receives standard connection metadata.
- API access depends on your internet connection, provider availability, and regional restrictions. See the [data contract](docs/data-contract.md).

## Deployment

Publish `index.html`, `style.css`, `api.js`, `preferences.js`, `script.js`, and `vendor/` together on a static host such as GitHub Pages. No build step or production credentials are needed.

An educational market-tracking project.
