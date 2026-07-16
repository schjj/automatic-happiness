/* =============================================================
   portfolio.js – Virtual paper-trading portfolio
   Manages cash, positions, order execution, and trade history.
   ============================================================= */

'use strict';

const STARTING_CASH = 100_000;

class Portfolio {
  constructor() {
    const saved = this._load();
    this._cash      = saved.cash      ?? STARTING_CASH;
    this._positions = saved.positions ?? {};  // symbol → { shares, avgCost }
    this._history   = saved.history   ?? [];  // array of trade records
    this._listeners = [];
  }

  // ── Public getters ────────────────────────────────────────

  get cash() { return this._cash; }

  getPosition(symbol) {
    return this._positions[symbol] || null;
  }

  getAllPositions() {
    return Object.entries(this._positions).map(([sym, pos]) => ({ symbol: sym, ...pos }));
  }

  getHistory() { return [...this._history]; }

  // ── Order execution ───────────────────────────────────────

  /**
   * Execute an order.
   * @param {string} side      – 'buy' | 'sell'
   * @param {string} symbol
   * @param {number} qty       – integer shares
   * @param {string} type      – 'market' | 'limit'
   * @param {number} limitPx   – required when type === 'limit'
   * @param {number} marketPx  – current market price (used for market orders & preview)
   * @returns {{ ok: boolean, message: string }}
   */
  executeOrder(side, symbol, qty, type, limitPx, marketPx) {
    qty = Math.floor(qty);
    if (!qty || qty <= 0) return { ok: false, message: 'Invalid quantity.' };

    const fillPrice = type === 'limit' ? limitPx : marketPx;
    if (!fillPrice || fillPrice <= 0) return { ok: false, message: 'Invalid price.' };

    if (side === 'buy') {
      const cost = fillPrice * qty;
      if (cost > this._cash) {
        return { ok: false, message: `Insufficient cash. Need $${_fmt(cost)}, have $${_fmt(this._cash)}.` };
      }
      this._cash -= cost;
      const pos = this._positions[symbol];
      if (pos) {
        const totalShares = pos.shares + qty;
        pos.avgCost = (pos.avgCost * pos.shares + fillPrice * qty) / totalShares;
        pos.shares  = totalShares;
      } else {
        this._positions[symbol] = { shares: qty, avgCost: fillPrice };
      }
      this._record('buy', symbol, qty, fillPrice);
      this._save();
      return { ok: true, message: `Bought ${qty} ${symbol} @ $${_fmt(fillPrice)}` };
    }

    if (side === 'sell') {
      const pos = this._positions[symbol];
      if (!pos || pos.shares < qty) {
        const have = pos ? pos.shares : 0;
        return { ok: false, message: `Not enough shares. Have ${have}, trying to sell ${qty}.` };
      }
      const proceeds = fillPrice * qty;
      this._cash   += proceeds;
      pos.shares   -= qty;
      if (pos.shares <= 0) delete this._positions[symbol];
      this._record('sell', symbol, qty, fillPrice);
      this._save();
      return { ok: true, message: `Sold ${qty} ${symbol} @ $${_fmt(fillPrice)}` };
    }

    return { ok: false, message: 'Unknown order side.' };
  }

  /**
   * Estimate the total value of a potential order (for UI preview).
   */
  preview(side, symbol, qty, type, limitPx, marketPx) {
    const price = type === 'limit' ? limitPx : marketPx;
    if (!price || !qty) return '';
    const total = price * qty;
    if (side === 'buy') return `Est. cost: $${_fmt(total)} | Cash after: $${_fmt(this._cash - total)}`;
    return `Est. proceeds: $${_fmt(total)}`;
  }

  /** Subscribe to portfolio changes: fn() */
  subscribe(fn) { this._listeners.push(fn); }

  // ── Persistence ───────────────────────────────────────────

  _save() {
    localStorage.setItem('tv_portfolio', JSON.stringify({
      cash:      this._cash,
      positions: this._positions,
      history:   this._history.slice(-500),
    }));
    this._notify();
  }

  _load() {
    try {
      const raw = localStorage.getItem('tv_portfolio');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _record(side, symbol, qty, price) {
    this._history.unshift({
      side, symbol, qty, price,
      total: qty * price,
      ts: Date.now(),
    });
  }

  _notify() { for (const fn of this._listeners) fn(); }
}

// ── Helpers ────────────────────────────────────────────────
function _fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Singleton ──────────────────────────────────────────────
const portfolio = new Portfolio();
