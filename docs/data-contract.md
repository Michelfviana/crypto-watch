# Data contract

Sources consulted on October 30, 2026:

- [Binance: public market data URLs](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md).
- [Binance: Spot REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md).
- [Binance: WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md).

The implementation uses `https://data-api.binance.vision/api/v3` and `wss://data-stream.binance.vision:443/stream`. These provide public market data without authentication. No account or trading endpoints are used.

| Operation | Parameters | Consumed fields |
| --- | --- | --- |
| `GET /ticker/24hr` | `symbols`: a JSON array encoded in the query | `symbol`, `lastPrice`, `priceChangePercent`, `quoteVolume`, `highPrice`, `lowPrice`, `priceChange` |
| `GET /ticker/price` | `symbol=USDTBRL` | `price` |
| `GET /depth` | `symbol=BTCUSDT`, `limit=5` | `asks` and `bids`: `[price, quantity]` pairs |
| `GET /klines` | `symbol`, `interval`, `limit` | Opening timestamp at index 0 and closing price at index 4 |
| Combined `@ticker` stream | Lowercase symbols separated by `/` | `data` object: `s`, `c`, `P`, `q`, `h`, `l`, `p` |

History uses 24 hourly bars, 42 four-hour bars, or 30 daily bars. The last bar may still be open. The interface shows closing prices in USDT and dates in the browser's time zone, with US English formatting. Sparklines are session samples without fixed time intervals.

## Failures and concurrency

- Each request has a 10-second timeout and validates the consumed fields before updating state.
- Unsuccessful HTTP responses and invalid JSON are treated as failures; they do not produce fabricated data.
- HTTP 429/418 blocks further REST requests until the `Retry-After` delay in seconds expires, or for 60 seconds when the header is missing.
- At most one snapshot, exchange-rate, or order-book request can run concurrently within each routine.
- Older history requests are canceled and ignored using request identifiers. History is cached by coin and time range for up to 60 seconds.
- A REST response does not replace a price already being updated by an active stream.
- Each reconnection closes the previous connection and ignores its events. The delay grows to 30 seconds, with a small random offset applied only to reconnection timing.
- Losing internet access removes the live connection state. Connection and snapshot updates resume when access returns.
- The order book is a periodic snapshot, not an incremental real-time reconstruction.

## Evidence and limitations

The Orbit catalog confirmed the price, kline, and order-book contracts. Its results did not cover the 24-hour ticker; that contract was checked against Binance's official documentation. No credentials were required.

Automated checks use a local HTTP server and fixtures based on these formats. They exercise the actual client and interface states; WebSocket transport is controlled by the checks. Read-only HTTP requests were also made to all four real public endpoints: the 24-hour ticker with a compact JSON symbol array, the USDT/BRL price, BTCUSDT order book, and klines. All returned HTTP 200 with the expected fields. This does not establish regional accessibility, browser CORS support, or continuous availability of external services. The `postman` executable in the development environment was the desktop app without the simulation CLI commands; reproducible verification uses Node.js and Chromium.
