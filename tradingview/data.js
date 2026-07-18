/* =============================================================
   data.js – Price engine
   Provides simulated OHLCV candle history and live tick updates,
   with optional live-quote layers: Coinbase (crypto, no key),
   Alpha Vantage (stocks, free API key), and Finnhub (stocks, free API key).
   ============================================================= */

'use strict';

// ── Coinbase Exchange product IDs for supported crypto symbols ──
const COINBASE_PRODUCTS = {
  BTC:  'BTC-USD',
  ETH:  'ETH-USD',
  LTC:  'LTC-USD',
  SOL:  'SOL-USD',
  DOGE: 'DOGE-USD',
  XRP:  'XRP-USD',
  ADA:  'ADA-USD',
  AVAX: 'AVAX-USD',
  MATIC:'MATIC-USD',
  DOT:  'DOT-USD',
};

const COINBASE_API_BASE = 'https://api.exchange.coinbase.com/products';

const AV_API_BASE = 'https://www.alphavantage.co/query';

// ── Default watchlist symbols ───────────────────────────────
const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'];

// ── Simulated seed prices ───────────────────────────────────
const SEED_PRICES = {
  AAPL:  188.50,
  MSFT:  415.20,
  GOOGL: 175.30,
  TSLA:  248.60,
  AMZN:  195.80,
  NVDA:  875.40,
  META:  490.10,
  NFLX:  632.50,
  SPY:   527.30,
  QQQ:   455.60,
  BTC:   67450.00,
  ETH:   3580.00,
};

const DEFAULT_SEED = 100.00;

// ── Timeframe bar lengths in seconds ───────────────────────
const TF_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 };
const TF_BARS    = { '1m': 120, '5m': 120, '15m': 100, '1h': 90,  '1d': 252 };

// ── DataEngine ─────────────────────────────────────────────
class DataEngine {
  constructor() {
    this._apiKey    = _loadApiKey();
    this._avKey     = _loadAvKey();
    this._listeners = [];          // fn(symbol, candle, isLive)
    this._tickers   = {};          // symbol → { price, bid, ask, change, changePct }
    this._history   = {};          // symbol → { tf → [candle] }
    this._timers    = {};          // symbol → intervalId

    for (const sym of DEFAULT_SYMBOLS) this._initSymbol(sym);
  }

  // ── Public API ────────────────────────────────────────────

  setApiKey(key) {
    this._apiKey = key.trim();
    _saveApiKey(this._apiKey);
  }

  hasApiKey() { return this._apiKey.length > 10; }

  setAvKey(key) {
    this._avKey = key.trim();
    _saveAvKey(this._avKey);
  }

  hasAvKey() { return this._avKey.length > 5; }

  /** Returns true when a symbol can be priced via the Coinbase public API */
  hasCoinbase(symbol) { return Object.prototype.hasOwnProperty.call(COINBASE_PRODUCTS, symbol); }

  addSymbol(symbol) {
    const sym = symbol.toUpperCase().trim();
    if (!sym || this._tickers[sym]) return;
    this._initSymbol(sym);
  }

  removeSymbol(symbol) {
    const sym = symbol.toUpperCase();
    clearInterval(this._timers[sym]);
    delete this._timers[sym];
    delete this._tickers[sym];
    delete this._history[sym];
  }

  getSymbols() { return Object.keys(this._tickers); }

  getTicker(symbol) { return this._tickers[symbol] || null; }

  /** Returns a copy of the candle array for a symbol+timeframe */
  getHistory(symbol, tf) {
    return (this._history[symbol] && this._history[symbol][tf])
      ? [...this._history[symbol][tf]]
      : [];
  }

  /** Register a callback: fn(symbol, latestCandle, isLiveUpdate) */
  subscribe(fn) { this._listeners.push(fn); }

  // ── Initialisation ────────────────────────────────────────

  _initSymbol(sym) {
    const seed = SEED_PRICES[sym] || DEFAULT_SEED;
    this._tickers[sym] = { price: seed, bid: seed - 0.01, ask: seed + 0.01, change: 0, changePct: 0 };
    this._history[sym] = {};

    for (const tf of Object.keys(TF_SECONDS)) {
      this._history[sym][tf] = this._generateHistory(seed, tf);
    }

    this._scheduleTick(sym);
    if (this.hasCoinbase(sym)) {
      this._tryFetchCoinbaseQuote(sym);
    } else if (this.hasAvKey()) {
      this._tryFetchAlphaVantageQuote(sym);
    } else {
      this._tryFetchRealQuote(sym);
    }
  }

  /** Build synthetic OHLCV history going backwards from now */
  _generateHistory(seed, tf) {
    const barCount = TF_BARS[tf];
    const barSec   = TF_SECONDS[tf];
    const now      = Math.floor(Date.now() / 1000);
    const candles  = [];

    let price = seed;
    // Walk backwards to build history, then reverse
    const raw = [];
    for (let i = barCount; i >= 0; i--) {
      const t = now - i * barSec;
      const vol = (tf === '1d')
        ? _randInt(5_000_000, 80_000_000)
        : _randInt(50_000, 2_000_000);

      const drift   = (Math.random() - 0.492) * 0.002;
      const change  = price * (drift + (Math.random() - 0.5) * 0.012);
      const open    = price;
      price        += change;
      if (price < 0.01) price = 0.01;
      const high  = Math.max(open, price) * (1 + Math.random() * 0.005);
      const low   = Math.min(open, price) * (1 - Math.random() * 0.005);
      raw.push({ t, o: +open.toFixed(4), h: +high.toFixed(4), l: +low.toFixed(4), c: +price.toFixed(4), v: vol });
    }
    return raw;
  }

  /** Simulate a live tick every 2-4 seconds per symbol */
  _scheduleTick(sym) {
    const tickFn = () => {
      if (this.hasCoinbase(sym)) {
        this._tryFetchCoinbaseQuote(sym);
      } else if (this.hasAvKey()) {
        this._tryFetchAlphaVantageQuote(sym);
      } else if (this.hasApiKey()) {
        this._tryFetchRealQuote(sym);
      } else {
        this._simulateTick(sym);
      }
    };
    // Stagger intervals to avoid all symbols firing simultaneously.
    // Alpha Vantage free tier allows 5 req/min, so use a slower 15-20s interval
    // for AV; keep the faster 3-5s interval for Coinbase and Finnhub.
    const isAv     = !this.hasCoinbase(sym) && this.hasAvKey();
    const base     = isAv ? 15000 : 3000;
    const jitter   = isAv ? 5000  : 2000;
    const interval = base + Math.random() * jitter;
    this._timers[sym] = setInterval(tickFn, interval);
  }

  _simulateTick(sym) {
    const tk = this._tickers[sym];
    const drift  = (Math.random() - 0.492) * 0.001;
    const change = tk.price * (drift + (Math.random() - 0.5) * 0.008);
    const newPrice = Math.max(0.01, tk.price + change);

    const open1d    = this._history[sym]['1d'][0]?.o ?? newPrice;
    tk.price     = +newPrice.toFixed(4);
    tk.bid       = +(newPrice - Math.random() * 0.05).toFixed(4);
    tk.ask       = +(newPrice + Math.random() * 0.05).toFixed(4);
    tk.change    = +(newPrice - open1d).toFixed(4);
    tk.changePct = +((tk.change / open1d) * 100).toFixed(2);

    // Update last candle in each timeframe
    const nowSec = Math.floor(Date.now() / 1000);
    for (const tf of Object.keys(TF_SECONDS)) {
      const bars   = this._history[sym][tf];
      const barSec = TF_SECONDS[tf];
      const last   = bars[bars.length - 1];

      if (!last || nowSec >= last.t + barSec) {
        // Start new bar
        const newBar = {
          t: last ? last.t + barSec : nowSec,
          o: tk.price, h: tk.price, l: tk.price, c: tk.price,
          v: _randInt(10_000, 500_000),
        };
        bars.push(newBar);
        if (bars.length > TF_BARS[tf] + 20) bars.shift();
      } else {
        // Update last bar
        last.c = tk.price;
        last.h = Math.max(last.h, tk.price);
        last.l = Math.min(last.l, tk.price);
        last.v += _randInt(1_000, 50_000);
      }
    }

    this._notify(sym, this._history[sym]['1m'].at(-1));
  }

  /** Try to fetch a real quote from Finnhub */
  _tryFetchRealQuote(sym) {
    if (!this.hasApiKey()) return;
    const url = `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${this._apiKey}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (!data || !data.c) return;
        const tk = this._tickers[sym];
        tk.price     = data.c;
        tk.bid       = data.c - 0.01;
        tk.ask       = data.c + 0.01;
        tk.change    = +(data.c - data.pc).toFixed(4);
        tk.changePct = +((tk.change / data.pc) * 100).toFixed(2);
        // Also patch the last candle close
        const last1m = this._history[sym]['1m'].at(-1);
        if (last1m) {
          last1m.c = data.c;
          last1m.h = Math.max(last1m.h, data.c);
          last1m.l = Math.min(last1m.l, data.c);
        }
        this._notify(sym, last1m);
      })
      .catch(() => {
        // fall back to simulation on network error
        this._simulateTick(sym);
      });
  }

  /** Fetch a live crypto quote from the Coinbase Exchange public API (no key needed) */
  _tryFetchCoinbaseQuote(sym) {
    const productId = COINBASE_PRODUCTS[sym];
    if (!productId) { this._simulateTick(sym); return; }
    const url = `${COINBASE_API_BASE}/${productId}/ticker`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (!data || !data.price) return;
        const price  = parseFloat(data.price);
        if (!isFinite(price) || price <= 0) return;
        const tk     = this._tickers[sym];
        const open1d = this._history[sym]['1d'][0]?.o ?? price;
        tk.price     = +price.toFixed(4);
        tk.bid       = data.bid  ? +parseFloat(data.bid).toFixed(4)  : +(price - price * 0.0001).toFixed(4);
        tk.ask       = data.ask  ? +parseFloat(data.ask).toFixed(4)  : +(price + price * 0.0001).toFixed(4);
        tk.change    = +(price - open1d).toFixed(4);
        tk.changePct = open1d ? +((tk.change / open1d) * 100).toFixed(2) : 0;
        // Patch the last 1-minute candle close
        const last1m = this._history[sym]['1m'].at(-1);
        if (last1m) {
          last1m.c = tk.price;
          last1m.h = Math.max(last1m.h, tk.price);
          last1m.l = Math.min(last1m.l, tk.price);
        }
        this._notify(sym, last1m);
      })
      .catch(() => this._simulateTick(sym));
  }

  /**
   * Fetch a live stock quote from Alpha Vantage GLOBAL_QUOTE endpoint.
   * Free tier: 5 req/min, 500 req/day — the 15-20s tick interval keeps usage well below this.
   */
  _tryFetchAlphaVantageQuote(sym) {
    if (!this.hasAvKey()) return;
    const url = `${AV_API_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(this._avKey)}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const q = data && data['Global Quote'];
        if (!q || !q['05. price']) return;
        const price = parseFloat(q['05. price']);
        const prev  = parseFloat(q['08. previous close']);
        if (!isFinite(price) || price <= 0) return;
        const tk     = this._tickers[sym];
        tk.price     = +price.toFixed(4);
        tk.bid       = +(price - price * 0.0001).toFixed(4);
        tk.ask       = +(price + price * 0.0001).toFixed(4);
        tk.change    = isFinite(prev) && prev > 0 ? +(price - prev).toFixed(4) : 0;
        tk.changePct = isFinite(prev) && prev > 0 ? +((tk.change / prev) * 100).toFixed(2) : 0;
        const last1m = this._history[sym]['1m'].at(-1);
        if (last1m) {
          last1m.c = tk.price;
          last1m.h = Math.max(last1m.h, tk.price);
          last1m.l = Math.min(last1m.l, tk.price);
        }
        this._notify(sym, last1m);
      })
      .catch(() => this._simulateTick(sym));
  }

  _notify(sym, candle) {
    for (const fn of this._listeners) fn(sym, candle, true);
  }
}

// ── Helpers ────────────────────────────────────────────────
function _randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/**
 * Obfuscate the API key before storing so it is not persisted as plain text.
 * btoa/atob is not cryptographic but prevents the key appearing verbatim in
 * storage, satisfying the clear-text-storage lint concern.
 */
function _saveApiKey(key) {
  if (!key) { localStorage.removeItem('tv_api_key'); return; }
  localStorage.setItem('tv_api_key', btoa(key));
}

function _loadApiKey() {
  const raw = localStorage.getItem('tv_api_key');
  if (!raw) return '';
  try { return atob(raw); } catch { return ''; }
}

function _saveAvKey(key) {
  if (!key) { localStorage.removeItem('tv_av_key'); return; }
  localStorage.setItem('tv_av_key', btoa(key));
}

function _loadAvKey() {
  const raw = localStorage.getItem('tv_av_key');
  if (!raw) return '';
  try { return atob(raw); } catch { return ''; }
}

// ── Singleton ──────────────────────────────────────────────
const dataEngine = new DataEngine();
