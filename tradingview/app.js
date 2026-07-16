/* =============================================================
   app.js – Main application wiring
   Connects DataEngine, ChartRenderer, and Portfolio together,
   and drives all UI interactions.
   ============================================================= */

'use strict';

// ── State ──────────────────────────────────────────────────
let activeSymbol  = null;
let activeTf      = '5m';
let activeSide    = 'buy';
let activeOverlays = { sma20: true, sma50: true, volume: true };

// ── Chart renderer ─────────────────────────────────────────
const chartCanvas   = document.getElementById('chart-canvas');
const chartRenderer = new ChartRenderer(chartCanvas);

// ── DOM refs ───────────────────────────────────────────────
const watchlistEl   = document.getElementById('watchlist');
const cashValueEl   = document.getElementById('cash-value');
const chartSymbolEl = document.getElementById('chart-symbol');
const chartPriceEl  = document.getElementById('chart-price');
const chartChangeEl = document.getElementById('chart-change');
const chartBidAskEl = document.getElementById('chart-bid-ask');
const positionsBody = document.getElementById('positions-body');
const posEmptyEl    = document.getElementById('positions-empty');
const historyListEl = document.getElementById('history-list');
const histEmptyEl   = document.getElementById('history-empty');
const orderMsgEl    = document.getElementById('order-message');
const orderPreview  = document.getElementById('order-preview');
const orderQtyEl    = document.getElementById('order-qty');
const orderTypeEl   = document.getElementById('order-type');
const limitPriceEl  = document.getElementById('limit-price');
const limitWrapEl   = document.getElementById('limit-price-wrap');
const submitBtn     = document.getElementById('order-submit-btn');

// ── Initialise watchlist from DataEngine ───────────────────
(function initWatchlist() {
  for (const sym of dataEngine.getSymbols()) _addWatchlistRow(sym);
})();

// ── Select first symbol ───────────────────────────────────
_selectSymbol(dataEngine.getSymbols()[0]);

// ── Symbol search / add ───────────────────────────────────
document.getElementById('symbol-add-btn').addEventListener('click', _onAddSymbol);
document.getElementById('symbol-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') _onAddSymbol();
});

function _onAddSymbol() {
  const input = document.getElementById('symbol-input');
  const sym   = input.value.trim().toUpperCase();
  if (!sym) return;
  if (dataEngine.getSymbols().includes(sym)) {
    _selectSymbol(sym);
    input.value = '';
    return;
  }
  dataEngine.addSymbol(sym);
  _addWatchlistRow(sym);
  _selectSymbol(sym);
  input.value = '';
}

// ── API key ───────────────────────────────────────────────
const apiKeyInput  = document.getElementById('api-key-input');
const apiSaveBtn   = document.getElementById('api-save-btn');
const apiStatusEl  = document.getElementById('api-status');

apiKeyInput.value = dataEngine.hasApiKey() ? '••••••••••••••••' : '';
_updateApiStatus();

apiSaveBtn.addEventListener('click', () => {
  dataEngine.setApiKey(apiKeyInput.value);
  _updateApiStatus();
  _flash(apiStatusEl, 'Saved ✓', 'var(--green)');
});

function _updateApiStatus() {
  apiStatusEl.textContent = dataEngine.hasApiKey() ? '🟢 Live' : '🟡 Simulated';
}

// ── DataEngine subscription ───────────────────────────────
dataEngine.subscribe((sym, candle, isLive) => {
  _updateWatchlistRow(sym);
  if (sym === activeSymbol) {
    _updateChartHeader(sym);
    if (candle && isLive) chartRenderer.updateLastCandle(candle);
  }
});

// ── Timeframe buttons ─────────────────────────────────────
document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTf = btn.dataset.tf;
    if (activeSymbol) chartRenderer.setCandles(dataEngine.getHistory(activeSymbol, activeTf));
  });
});

// ── Overlay toggles ───────────────────────────────────────
document.querySelectorAll('.ov-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key     = btn.dataset.ov;
    const enabled = !activeOverlays[key];
    activeOverlays[key] = enabled;
    btn.classList.toggle('active', enabled);
    chartRenderer.setOverlay(key, enabled);
  });
});

// ── Order side tabs ───────────────────────────────────────
document.querySelectorAll('.order-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.order-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSide = tab.dataset.side;
    submitBtn.classList.toggle('sell-mode', activeSide === 'sell');
    submitBtn.textContent = activeSide === 'buy' ? 'Submit Buy Order' : 'Submit Sell Order';
    _updatePreview();
  });
});

// ── Order type toggle ─────────────────────────────────────
orderTypeEl.addEventListener('change', () => {
  limitWrapEl.classList.toggle('hidden', orderTypeEl.value !== 'limit');
  _updatePreview();
});

// ── Preview on input ──────────────────────────────────────
[orderQtyEl, limitPriceEl].forEach(el => el.addEventListener('input', _updatePreview));

function _updatePreview() {
  if (!activeSymbol) return;
  const tk    = dataEngine.getTicker(activeSymbol);
  const qty   = parseInt(orderQtyEl.value, 10) || 0;
  const lxPx  = parseFloat(limitPriceEl.value) || 0;
  orderPreview.textContent = portfolio.preview(activeSide, activeSymbol, qty, orderTypeEl.value, lxPx, tk?.price || 0);
}

// ── Order submit ──────────────────────────────────────────
submitBtn.addEventListener('click', _submitOrder);

function _submitOrder() {
  if (!activeSymbol) { _flashMsg('Select a symbol first.', false); return; }
  const tk     = dataEngine.getTicker(activeSymbol);
  const qty    = parseInt(orderQtyEl.value, 10);
  const type   = orderTypeEl.value;
  const lxPx   = parseFloat(limitPriceEl.value) || 0;
  const mktPx  = tk?.price || 0;

  if (type === 'limit' && lxPx <= 0) { _flashMsg('Enter a valid limit price.', false); return; }

  const result = portfolio.executeOrder(activeSide, activeSymbol, qty, type, lxPx, mktPx);
  _flashMsg(result.message, result.ok);
  if (result.ok) {
    _renderPortfolio();
    _renderCash();
  }
}

// ── Portfolio UI ──────────────────────────────────────────
portfolio.subscribe(() => { _renderPortfolio(); _renderCash(); });

function _renderCash() {
  cashValueEl.textContent = '$' + portfolio.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _renderPortfolio() {
  const positions = portfolio.getAllPositions();
  positionsBody.innerHTML = '';
  posEmptyEl.classList.toggle('hidden', positions.length > 0);

  for (const pos of positions) {
    const tk    = dataEngine.getTicker(pos.symbol);
    const cur   = tk ? tk.price : pos.avgCost;
    const value = cur * pos.shares;
    const pl    = (cur - pos.avgCost) * pos.shares;
    const plCls = pl >= 0 ? 'pos' : 'neg';
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="#" class="pos-sym">${pos.symbol}</a></td>
      <td>${pos.shares}</td>
      <td>$${pos.avgCost.toFixed(2)}</td>
      <td>$${_fmtN(value)}</td>
      <td class="${plCls}">${pl >= 0 ? '+' : ''}$${_fmtN(pl)}</td>
    `;
    tr.querySelector('.pos-sym').addEventListener('click', e => { e.preventDefault(); _selectSymbol(pos.symbol); });
    positionsBody.appendChild(tr);
  }

  // Trade history
  const trades = portfolio.getHistory();
  historyListEl.innerHTML = '';
  histEmptyEl.classList.toggle('hidden', trades.length > 0);
  for (const t of trades.slice(0, 40)) {
    const div = document.createElement('div');
    div.className = 'history-row';
    const d   = new Date(t.ts);
    const ts  = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <span class="hist-${t.side}">${t.side.toUpperCase()} ${t.qty} ${t.symbol} @ $${t.price.toFixed(2)}</span>
      <span>${ts}</span>
    `;
    historyListEl.appendChild(div);
  }
}

// ── Watchlist helpers ─────────────────────────────────────

function _addWatchlistRow(sym) {
  const li = document.createElement('li');
  li.dataset.sym = sym;

  const top = document.createElement('div');
  top.className = 'wl-top';
  const symSpan = document.createElement('span');
  symSpan.className = 'wl-symbol';
  symSpan.textContent = sym;
  const priceSpan = document.createElement('span');
  priceSpan.className = 'wl-price';
  priceSpan.textContent = '—';
  top.appendChild(symSpan);
  top.appendChild(priceSpan);

  const changeSpan = document.createElement('span');
  changeSpan.className = 'wl-change';
  changeSpan.textContent = '—';

  const sparkCanvas = document.createElement('canvas');
  sparkCanvas.className = 'sparkline-canvas';
  sparkCanvas.width  = 140;
  sparkCanvas.height = 26;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'wl-remove';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '✕';

  li.appendChild(top);
  li.appendChild(changeSpan);
  li.appendChild(sparkCanvas);
  li.appendChild(removeBtn);
  li.addEventListener('click', e => {
    if (e.target.classList.contains('wl-remove')) return;
    _selectSymbol(sym);
  });
  li.querySelector('.wl-remove').addEventListener('click', () => {
    dataEngine.removeSymbol(sym);
    li.remove();
    if (activeSymbol === sym) {
      const next = dataEngine.getSymbols()[0];
      if (next) _selectSymbol(next); else activeSymbol = null;
    }
  });
  watchlistEl.appendChild(li);
  _updateWatchlistRow(sym);
}

function _updateWatchlistRow(sym) {
  const li = watchlistEl.querySelector(`[data-sym="${sym}"]`);
  if (!li) return;
  const tk = dataEngine.getTicker(sym);
  if (!tk) return;
  const up  = tk.changePct >= 0;
  li.querySelector('.wl-price').textContent  = '$' + _fmtN(tk.price);
  const chEl = li.querySelector('.wl-change');
  chEl.textContent  = (up ? '+' : '') + tk.changePct.toFixed(2) + '%';
  chEl.className    = 'wl-change ' + (up ? 'pos' : 'neg');

  const sp  = li.querySelector('.sparkline-canvas');
  const candles1d = dataEngine.getHistory(sym, '1d');
  drawSparkline(sp, candles1d.slice(-40));
}

// ── Symbol selection ──────────────────────────────────────

function _selectSymbol(sym) {
  if (!sym) return;
  activeSymbol = sym;

  // Highlight watchlist row
  watchlistEl.querySelectorAll('li').forEach(li => li.classList.toggle('active', li.dataset.sym === sym));

  // Load chart
  chartRenderer.setCandles(dataEngine.getHistory(sym, activeTf));
  _updateChartHeader(sym);
  _updatePreview();
}

function _updateChartHeader(sym) {
  const tk = dataEngine.getTicker(sym);
  if (!tk) return;
  const up = tk.changePct >= 0;
  chartSymbolEl.textContent  = sym;
  chartPriceEl.textContent   = '$' + _fmtN(tk.price);
  chartChangeEl.textContent  = (up ? '▲ +' : '▼ ') + Math.abs(tk.changePct).toFixed(2) + '%';
  chartChangeEl.className    = up ? 'pos' : 'neg';
  chartBidAskEl.textContent  = `Bid $${tk.bid.toFixed(2)}  Ask $${tk.ask.toFixed(2)}`;
  document.title             = `${sym} $${_fmtN(tk.price)} – TraderView`;
}

// ── Utilities ──────────────────────────────────────────────

function _fmtN(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _flashMsg(msg, ok) {
  orderMsgEl.textContent  = msg;
  orderMsgEl.style.color  = ok ? 'var(--green)' : 'var(--red)';
  clearTimeout(orderMsgEl._t);
  orderMsgEl._t = setTimeout(() => { orderMsgEl.textContent = ''; }, 4000);
}

function _flash(el, text, color) {
  const prev = el.textContent;
  el.textContent = text;
  el.style.color = color;
  setTimeout(() => { el.textContent = prev; el.style.color = ''; }, 2000);
}

// ── Initial render ────────────────────────────────────────
_renderCash();
_renderPortfolio();
submitBtn.textContent = 'Submit Buy Order';
