/* =============================================================
   charts.js – Canvas 2D chart renderer
   Draws candlestick / OHLCV bars with SMA overlays, volume bars,
   crosshair, and a price axis.
   ============================================================= */

'use strict';

class ChartRenderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.candles = [];
    this.overlays = { sma20: true, sma50: true, volume: true };

    // colours
    this.C = {
      bg:       '#0d1117',
      grid:     '#21262d',
      axisText: '#8b949e',
      up:       '#3fb950',
      down:     '#f85149',
      wick:     '#8b949e',
      sma20:    '#d29922',
      sma50:    '#1f6feb',
      volume:   'rgba(139,148,158,0.25)',
      cross:    'rgba(139,148,158,0.6)',
    };

    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(canvas);
    this._resize();

    canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    canvas.addEventListener('mouseleave', () => { this._crossX = null; this._crossY = null; this.draw(); });

    this._crossX = null;
    this._crossY = null;
  }

  setCandles(candles) {
    this.candles = candles;
    this.draw();
  }

  setOverlay(key, enabled) {
    this.overlays[key] = enabled;
    this.draw();
  }

  updateLastCandle(candle) {
    if (!this.candles.length) return;
    const last = this.candles[this.candles.length - 1];
    if (last.t === candle.t) {
      Object.assign(last, candle);
    } else {
      this.candles.push({ ...candle });
      if (this.candles.length > 500) this.candles.shift();
    }
    this.draw();
  }

  // ── Resize ───────────────────────────────────────────────
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width  = rect.width  * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
    this.draw();
  }

  // ── Mouse ────────────────────────────────────────────────
  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this._crossX = e.clientX - rect.left;
    this._crossY = e.clientY - rect.top;
    this.draw();
  }

  // ── Main draw ────────────────────────────────────────────
  draw() {
    const { ctx, _w: W, _h: H } = this;
    if (!W || !H) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.C.bg;
    ctx.fillRect(0, 0, W, H);

    if (!this.candles.length) {
      ctx.fillStyle = this.C.axisText;
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select a symbol to view chart', W / 2, H / 2);
      return;
    }

    // Layout constants
    const PAD_LEFT   = 10;
    const PAD_RIGHT  = 60;
    const PAD_TOP    = 14;
    const PAD_BOTTOM = 28;
    const VOL_H      = this.overlays.volume ? Math.floor(H * 0.18) : 0;
    const PRICE_H    = H - PAD_TOP - PAD_BOTTOM - VOL_H - (VOL_H ? 4 : 0);
    const PRICE_TOP  = PAD_TOP;

    const candles   = this.candles;
    const n         = candles.length;
    const chartW    = W - PAD_LEFT - PAD_RIGHT;
    const barW      = Math.max(1, chartW / n);
    const candleW   = Math.max(1, barW * 0.6);

    // Price range
    let minP = Infinity, maxP = -Infinity;
    for (const c of candles) { minP = Math.min(minP, c.l); maxP = Math.max(maxP, c.h); }
    const pad   = (maxP - minP) * 0.05 || maxP * 0.01;
    minP -= pad; maxP += pad;
    const priceRange = maxP - minP || 1;

    const toY = (price) => PRICE_TOP + PRICE_H * (1 - (price - minP) / priceRange);
    const toX = (i)     => PAD_LEFT + i * barW + barW / 2;

    // ── Grid ──────────────────────────────────────────────
    ctx.strokeStyle = this.C.grid;
    ctx.lineWidth   = 0.5;
    const gridLines = 5;
    for (let g = 0; g <= gridLines; g++) {
      const y = PRICE_TOP + (PRICE_H / gridLines) * g;
      ctx.beginPath(); ctx.moveTo(PAD_LEFT, y); ctx.lineTo(W - PAD_RIGHT, y); ctx.stroke();
      const price = maxP - (priceRange / gridLines) * g;
      ctx.fillStyle  = this.C.axisText;
      ctx.font       = '10px system-ui';
      ctx.textAlign  = 'left';
      ctx.fillText(_fmtPrice(price), W - PAD_RIGHT + 4, y + 3);
    }

    // ── Candles ───────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const c  = candles[i];
      const x  = toX(i);
      const up = c.c >= c.o;
      const color = up ? this.C.up : this.C.down;

      const yOpen  = toY(c.o);
      const yClose = toY(c.c);
      const yHigh  = toY(c.h);
      const yLow   = toY(c.l);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      const bodyY = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW / 2, bodyY, candleW, bodyH);
    }

    // ── SMA ───────────────────────────────────────────────
    if (this.overlays.sma20 && n >= 20) this._drawSMA(candles, 20, toX, toY, this.C.sma20, PAD_LEFT, W - PAD_RIGHT);
    if (this.overlays.sma50 && n >= 50) this._drawSMA(candles, 50, toX, toY, this.C.sma50, PAD_LEFT, W - PAD_RIGHT);

    // ── Volume bars ───────────────────────────────────────
    if (this.overlays.volume && VOL_H > 0) {
      const VOL_TOP = H - PAD_BOTTOM - VOL_H;
      let maxV = 0;
      for (const c of candles) maxV = Math.max(maxV, c.v);
      for (let i = 0; i < n; i++) {
        const c  = candles[i];
        const x  = toX(i);
        const bh = VOL_H * (c.v / (maxV || 1));
        ctx.fillStyle = c.c >= c.o ? 'rgba(63,185,80,0.35)' : 'rgba(248,81,73,0.35)';
        ctx.fillRect(x - candleW / 2, VOL_TOP + VOL_H - bh, candleW, bh);
      }
    }

    // ── X-axis time labels ────────────────────────────────
    ctx.fillStyle = this.C.axisText;
    ctx.font      = '10px system-ui';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(n / 8));
    for (let i = 0; i < n; i += labelStep) {
      const c = candles[i];
      const x = toX(i);
      const d = new Date(c.t * 1000);
      const label = _fmtTime(d);
      ctx.fillText(label, x, H - PAD_BOTTOM + 14);
    }

    // ── Crosshair ─────────────────────────────────────────
    if (this._crossX !== null) {
      ctx.strokeStyle = this.C.cross;
      ctx.lineWidth   = 0.8;
      ctx.setLineDash([4, 4]);

      ctx.beginPath(); ctx.moveTo(this._crossX, PAD_TOP); ctx.lineTo(this._crossX, H - PAD_BOTTOM); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD_LEFT, this._crossY); ctx.lineTo(W - PAD_RIGHT, this._crossY); ctx.stroke();

      ctx.setLineDash([]);

      // Price label on y-axis
      const hoverPrice = maxP - ((this._crossY - PRICE_TOP) / PRICE_H) * priceRange;
      if (hoverPrice >= minP && hoverPrice <= maxP) {
        ctx.fillStyle = '#1f6feb';
        const labelW = 52, labelH = 16;
        ctx.fillRect(W - PAD_RIGHT + 2, this._crossY - labelH / 2, labelW, labelH);
        ctx.fillStyle = '#fff';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(_fmtPrice(hoverPrice), W - PAD_RIGHT + 5, this._crossY + 4);
      }

      // Candle tooltip near cursor
      const idx = Math.max(0, Math.min(n - 1, Math.round((this._crossX - PAD_LEFT) / barW)));
      const hc  = candles[idx];
      if (hc) {
        const d = new Date(hc.t * 1000);
        const lines = [
          `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`,
          `O: ${_fmtPrice(hc.o)}  H: ${_fmtPrice(hc.h)}`,
          `L: ${_fmtPrice(hc.l)}  C: ${_fmtPrice(hc.c)}`,
          `Vol: ${_fmtVol(hc.v)}`,
        ];
        const tipX = Math.min(this._crossX + 10, W - PAD_RIGHT - 120);
        const tipY = Math.max(PRICE_TOP + 10, this._crossY - 60);
        ctx.fillStyle = 'rgba(22,27,34,0.92)';
        ctx.fillRect(tipX, tipY, 125, 62);
        ctx.strokeStyle = this.C.grid;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(tipX, tipY, 125, 62);
        ctx.fillStyle = this.C.axisText;
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        lines.forEach((l, i) => ctx.fillText(l, tipX + 6, tipY + 14 + i * 13));
      }
    }
  }

  // ── SMA helper ────────────────────────────────────────────
  _drawSMA(candles, period, toX, toY, color, xMin, xMax) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].c;
      const avg = sum / period;
      const x   = toX(i);
      const y   = toY(avg);
      if (x < xMin || x > xMax) continue;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ── Sparkline helper (used by watchlist) ────────────────────
function drawSparkline(canvas, candles) {
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!candles || candles.length < 2) return;

  const prices = candles.map(c => c.c);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const up  = prices.at(-1) >= prices[0];
  ctx.strokeStyle = up ? '#3fb950' : '#f85149';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  prices.forEach((p, i) => {
    const x = (i / (prices.length - 1)) * W;
    const y = H - ((p - min) / range) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Format helpers ──────────────────────────────────────────
function _fmtPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toFixed(p < 1 ? 4 : 2);
}

function _fmtVol(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

function _fmtTime(d) {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
