/* ========================================================
   Colonies – Board Game  (game.js)
   Single-file vanilla JS implementation.
   ======================================================== */

// ── Constants ──────────────────────────────────────────────
const RESOURCES = ['wood', 'brick', 'ore', 'grain', 'sheep'];
const RESOURCE_EMOJI = { wood: '🪵', brick: '🧱', ore: '⛏️', grain: '🌾', sheep: '🐑', desert: '🏜️' };

const TERRAIN_COUNTS = { wood: 4, brick: 3, ore: 3, grain: 4, sheep: 4, desert: 1 };
const NUMBER_TOKENS  = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12]; // 18 tiles (no desert)

const PLAYER_COLOURS = ['#e74c3c','#3498db','#2ecc71','#f39c12'];
const PLAYER_NAMES_DEFAULT = ['Red','Blue','Green','Orange'];

// Build costs
const COSTS = {
  road:       { wood:1, brick:1 },
  settlement: { wood:1, brick:1, grain:1, sheep:1 },
  city:       { ore:3, grain:2 },
};

// Hex grid ring layout (standard Catan-style 3-ring board)
// Each hex defined by axial coords (q,r)
const HEX_LAYOUT = generateHexLayout();

function generateHexLayout() {
  const hexes = [];
  const radius = 2; // 2 rings around centre → 19 hexes
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius,  -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push({ q, r, s: -q - r });
    }
  }
  return hexes; // 19 hexes
}

// ── State ──────────────────────────────────────────────────
let G = {}; // global game state

// ── Setup screen ───────────────────────────────────────────
(function initSetup() {
  const pcSelect   = document.getElementById('player-count');
  const namesDiv   = document.getElementById('player-names');
  const startBtn   = document.getElementById('start-btn');

  function renderNameFields() {
    const n = parseInt(pcSelect.value, 10);
    namesDiv.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const lbl = document.createElement('label');
      lbl.innerHTML = `Player ${i+1} name
        <input type="text" id="pname-${i}" placeholder="${PLAYER_NAMES_DEFAULT[i]}" maxlength="16" />`;
      namesDiv.appendChild(lbl);
    }
  }

  pcSelect.addEventListener('change', renderNameFields);
  renderNameFields();

  startBtn.addEventListener('click', () => {
    const n = parseInt(pcSelect.value, 10);
    const names = [];
    for (let i = 0; i < n; i++) {
      const v = document.getElementById(`pname-${i}`).value.trim();
      names.push(v || PLAYER_NAMES_DEFAULT[i]);
    }
    startGame(n, names);
  });
})();

// ── Game initialisation ────────────────────────────────────
function startGame(numPlayers, names) {
  G = {
    numPlayers,
    players: names.map((name, i) => ({
      name,
      colour: PLAYER_COLOURS[i],
      resources: { wood:0, brick:0, ore:0, grain:0, sheep:0 },
      settlements: [],  // vertex indices
      cities: [],       // vertex indices
      roads: [],        // edge keys "v1-v2"
      vp: 0,
    })),
    tiles: buildTiles(),
    vertices: [],       // populated in buildBoard()
    edges: [],          // populated in buildBoard()
    currentPlayer: 0,
    phase: 'setup1',    // setup1 → setup2 → main
    setupSettlementsPlaced: 0,
    diceRolled: false,
    diceValues: [0, 0],
    longestRoadPlayer: -1,
    longestRoadLength: 0,
    activeAction: null, // 'road' | 'settlement' | 'city' | null
    log: [],
  };

  buildBoard();
  populateTradeSelects();
  showScreen('game-screen');
  renderAll();
  addLog(`Game started with ${numPlayers} players. 🏝️`);
  addLog(`${currentPlayer().name}'s turn — place your first settlement.`);
}

function buildTiles() {
  // Shuffle terrains
  const terrainPool = [];
  for (const [type, count] of Object.entries(TERRAIN_COUNTS)) {
    for (let i = 0; i < count; i++) terrainPool.push(type);
  }
  shuffle(terrainPool);

  // Assign number tokens (skip desert)
  const numberPool = [...NUMBER_TOKENS];
  shuffle(numberPool);

  return HEX_LAYOUT.map((hex, idx) => {
    const terrain = terrainPool[idx];
    const number  = terrain === 'desert' ? null : numberPool.shift();
    return { ...hex, terrain, number, idx };
  });
}

// ── Board geometry ─────────────────────────────────────────
// We use axial→pixel conversion with pointy-top hexes.
// Vertices and edges are shared between hexes.

const HEX_SIZE = 60; // pixels, will be scaled dynamically

function axialToPixel(q, r, size) {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
  const y = size * (3/2 * r);
  return { x, y };
}

// 6 corners of a flat-top hex centred at (cx,cy)
function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30; // pointy-top
    const angleRad = Math.PI / 180 * angleDeg;
    pts.push({ x: cx + size * Math.cos(angleRad), y: cy + size * Math.sin(angleRad) });
  }
  return pts;
}

// Shared vertex/edge structures built once
function buildBoard() {
  const SCALE = getHexSize();
  const { ox, oy } = getBoardOrigin(SCALE);

  const vertexMap = new Map(); // key → vertex
  const edgeMap   = new Map(); // key → edge

  // Build tiles with pixel centres + corner vertex refs
  G.tiles.forEach(tile => {
    const { x, y } = axialToPixel(tile.q, tile.r, SCALE);
    tile.px = ox + x;
    tile.py = oy + y;
    tile.corners = []; // vertex indices

    const corners = hexCorners(tile.px, tile.py, SCALE);
    corners.forEach(pt => {
      const key = vertexKey(pt.x, pt.y);
      if (!vertexMap.has(key)) {
        vertexMap.set(key, { id: vertexMap.size, x: pt.x, y: pt.y, owner: -1, type: null });
      }
      tile.corners.push(vertexMap.get(key).id);
    });
  });

  G.vertices = Array.from(vertexMap.values());

  // Build adjacency: which hexes touch each vertex
  G.vertices.forEach(v => { v.adjacentHexes = []; v.adjacentVertices = []; });
  G.tiles.forEach(tile => {
    tile.corners.forEach(vid => {
      G.vertices[vid].adjacentHexes.push(tile.idx);
    });
    // edges between consecutive corners
    for (let i = 0; i < 6; i++) {
      const a = tile.corners[i];
      const b = tile.corners[(i+1) % 6];
      const eKey = edgeKey(a, b);
      if (!edgeMap.has(eKey)) {
        edgeMap.set(eKey, { id: edgeMap.size, v1: a, v2: b, owner: -1 });
      }
    }
  });

  G.edges = Array.from(edgeMap.values());

  // Build vertex adjacency (via shared edges)
  G.edges.forEach(e => {
    G.vertices[e.v1].adjacentVertices.push(e.v2);
    G.vertices[e.v2].adjacentVertices.push(e.v1);
  });

  // Build tile adjacency list on hex itself
  G.tiles.forEach(tile => {
    tile.adjTiles = [];
    const dirs = [[1,-1,0],[-1,1,0],[1,0,-1],[-1,0,1],[0,1,-1],[0,-1,1]];
    dirs.forEach(([dq,dr]) => {
      const n = G.tiles.find(t => t.q === tile.q+dq && t.r === tile.r+dr);
      if (n) tile.adjTiles.push(n.idx);
    });
  });
}

function vertexKey(x, y) {
  return `${Math.round(x)},${Math.round(y)}`;
}
function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function getHexSize() {
  const canvas = document.getElementById('board-canvas');
  return Math.min(canvas.width, canvas.height) / 9;
}

function getBoardOrigin(size) {
  const canvas = document.getElementById('board-canvas');
  // Centre of the board in canvas coords
  const cx = (canvas.width - 240) / 2; // 240 = side panel width approximation
  const cy = canvas.height / 2;
  return { ox: cx, oy: cy };
}

// ── Rendering ──────────────────────────────────────────────
const TERRAIN_COLOURS = {
  wood:   '#4a7c3f',
  brick:  '#9e4a1a',
  ore:    '#6b6b80',
  grain:  '#c8a010',
  sheep:  '#5cb85c',
  desert: '#c4a870',
};

function renderAll() {
  renderCanvas();
  renderScoreboard();
  renderResources();
  renderPhaseUI();
  renderLog();
}

function renderCanvas() {
  const canvas = document.getElementById('board-canvas');
  const ctx = canvas.getContext('2d');
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const size = getHexSize();
  rebuildBoardGeometry(size); // update px/py when canvas resizes

  // Draw hexes
  G.tiles.forEach(tile => drawHex(ctx, tile, size));

  // Draw edges (roads)
  G.edges.forEach(e => drawEdge(ctx, e));

  // Draw vertices (settlements / cities / build spots)
  G.vertices.forEach(v => drawVertex(ctx, v, size));
}

function rebuildBoardGeometry(size) {
  const { ox, oy } = getBoardOrigin(size);
  G.tiles.forEach(tile => {
    const { x, y } = axialToPixel(tile.q, tile.r, size);
    tile.px = ox + x;
    tile.py = oy + y;
    // Update vertex pixel positions
    const corners = hexCorners(tile.px, tile.py, size);
    tile.corners.forEach((vid, i) => {
      G.vertices[vid].x = corners[i].x;
      G.vertices[vid].y = corners[i].y;
    });
  });
}

function drawHex(ctx, tile, size) {
  const corners = hexCorners(tile.px, tile.py, size);
  ctx.beginPath();
  corners.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.closePath();
  ctx.fillStyle   = TERRAIN_COLOURS[tile.terrain];
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Number token
  if (tile.number) {
    const isRed = tile.number === 6 || tile.number === 8;
    ctx.beginPath();
    ctx.arc(tile.px, tile.py, size * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245,240,220,.9)';
    ctx.fill();
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle   = isRed ? '#c0392b' : '#333';
    ctx.font        = `bold ${Math.round(size * 0.26)}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tile.number, tile.px, tile.py);
  } else {
    // Desert emoji
    ctx.font = `${Math.round(size * 0.4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏜️', tile.px, tile.py);
  }
}

function drawEdge(ctx, e) {
  const v1 = G.vertices[e.v1];
  const v2 = G.vertices[e.v2];
  if (e.owner >= 0) {
    ctx.strokeStyle = G.players[e.owner].colour;
    ctx.lineWidth   = 5;
    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.stroke();
  }

  // Highlight if active build action = road
  if (G.activeAction === 'road' && e.owner < 0 && isEdgeValidForRoad(e)) {
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth   = 4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawVertex(ctx, v, size) {
  const r = size * 0.18;

  if (v.owner >= 0) {
    const colour = G.players[v.owner].colour;
    ctx.fillStyle   = colour;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;

    if (v.type === 'city') {
      // City: larger square
      const s = r * 1.6;
      ctx.fillRect(v.x - s/2, v.y - s/2, s, s);
      ctx.strokeRect(v.x - s/2, v.y - s/2, s, s);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏙', v.x, v.y);
    } else {
      // Settlement: circle with house icon
      ctx.beginPath();
      ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏠', v.x, v.y);
    }
    return;
  }

  // Clickable spot highlight
  const isSetupPhase  = G.phase === 'setup1' || G.phase === 'setup2';
  const isSettlement  = G.activeAction === 'settlement';
  const isCity        = G.activeAction === 'city';

  if (isSetupPhase && isVertexValidForSettlement(v)) {
    ctx.fillStyle   = 'rgba(255,255,255,.25)';
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (isSettlement && isVertexValidForSettlement(v) && isVertexConnected(v)) {
    ctx.fillStyle   = 'rgba(255,255,255,.25)';
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (isCity && v.owner === G.currentPlayer && v.type === 'settlement') {
    ctx.fillStyle   = 'rgba(245,166,35,.35)';
    ctx.strokeStyle = 'rgba(245,166,35,.9)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ── Sidebar UI ──────────────────────────────────────────────
function renderScoreboard() {
  const div = document.getElementById('scoreboard');
  div.innerHTML = '';
  updateVP();
  G.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (i === G.currentPlayer ? ' current-turn' : '');
    row.innerHTML = `<span class="player-dot" style="background:${p.colour}"></span>
                     <span>${p.name}</span>
                     <span class="score-vp">${p.vp} VP</span>`;
    div.appendChild(row);
  });
}

function renderResources() {
  const p   = currentPlayer();
  const div = document.getElementById('resource-display');
  div.innerHTML = '';
  RESOURCES.forEach(res => {
    const amt = p.resources[res] || 0;
    const chip = document.createElement('span');
    chip.className = `res-chip ${res}`;
    chip.textContent = `${RESOURCE_EMOJI[res]} ${amt}`;
    chip.title = `${res}: ${amt}`;
    div.appendChild(chip);
  });
}

function renderPhaseUI() {
  const p = currentPlayer();
  document.getElementById('turn-label').textContent  = `${p.name}'s Turn`;
  document.getElementById('turn-label').style.color  = p.colour;

  const phaseMessages = {
    setup1: '📍 Place settlement + road',
    setup2: '📍 Place settlement + road (reversed)',
    main:   G.diceRolled ? '🏗️ Build or trade' : '🎲 Roll dice',
  };
  document.getElementById('phase-label').textContent = phaseMessages[G.phase] || '';

  const rollBtn    = document.getElementById('roll-btn');
  const endTurnBtn = document.getElementById('end-turn-btn');
  const buildBtns  = document.querySelectorAll('.build-btn');

  const isMain = G.phase === 'main';
  rollBtn.disabled    = !isMain || G.diceRolled;
  endTurnBtn.disabled = !isMain || !G.diceRolled;

  buildBtns.forEach(btn => {
    const action  = btn.dataset.action;
    btn.disabled  = !isMain || !G.diceRolled || !canAfford(action);
    btn.classList.toggle('active', G.activeAction === action);
  });
}

function renderLog() {
  const div = document.getElementById('game-log');
  div.innerHTML = G.log.slice(-20).map(l => `<p>${l}</p>`).join('');
  div.scrollTop = div.scrollHeight;
}

function addLog(msg) {
  G.log.push(msg);
  renderLog();
}

// ── VP calculation ──────────────────────────────────────────
function updateVP() {
  updateLongestRoad();
  G.players.forEach((p, i) => {
    let vp = p.settlements.length + p.cities.length * 2;
    if (G.longestRoadPlayer === i) vp += 2;
    p.vp = vp;
  });
}

function updateLongestRoad() {
  let best = G.longestRoadLength;
  let bestPlayer = G.longestRoadPlayer;

  G.players.forEach((p, pi) => {
    const len = longestRoadForPlayer(pi);
    if (len >= 5 && len > best) {
      best = len;
      bestPlayer = pi;
    }
  });
  G.longestRoadLength = best;
  G.longestRoadPlayer = bestPlayer;
}

function longestRoadForPlayer(pi) {
  // Build adjacency graph for this player's roads
  const adj = new Map();
  G.edges.forEach(e => {
    if (e.owner !== pi) return;
    if (!adj.has(e.v1)) adj.set(e.v1, []);
    if (!adj.has(e.v2)) adj.set(e.v2, []);
    adj.get(e.v1).push(e.v2);
    adj.get(e.v2).push(e.v1);
  });

  let max = 0;
  const visited = new Set();

  function dfs(v, prev) {
    let best = 0;
    (adj.get(v) || []).forEach(n => {
      const eKey = edgeKey(v, n);
      if (!visited.has(eKey)) {
        visited.add(eKey);
        const len = 1 + dfs(n, v);
        if (len > best) best = len;
        visited.delete(eKey);
      }
    });
    return best;
  }

  adj.forEach((_, start) => {
    const len = dfs(start, null);
    if (len > max) max = len;
  });
  return max;
}

// ── Dice ────────────────────────────────────────────────────
document.getElementById('roll-btn').addEventListener('click', () => {
  if (G.phase !== 'main' || G.diceRolled) return;
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  G.diceValues = [d1, d2];
  G.diceRolled = true;

  document.getElementById('die1').textContent = d1;
  document.getElementById('die2').textContent = d2;

  const total = d1 + d2;
  addLog(`🎲 ${currentPlayer().name} rolled ${d1}+${d2}=${total}`);

  distributeResources(total);
  renderAll();
});

function distributeResources(total) {
  G.tiles.forEach(tile => {
    if (tile.number !== total) return;
    tile.corners.forEach(vid => {
      const v = G.vertices[vid];
      if (v.owner < 0) return;
      const amount = v.type === 'city' ? 2 : 1;
      G.players[v.owner].resources[tile.terrain] = (G.players[v.owner].resources[tile.terrain] || 0) + amount;
      addLog(`  ${G.players[v.owner].name} gets ${amount}× ${RESOURCE_EMOJI[tile.terrain]} ${tile.terrain}`);
    });
  });
}

// ── Build actions ────────────────────────────────────────────
document.querySelectorAll('.build-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (!canAfford(action)) return;
    G.activeAction = G.activeAction === action ? null : action;
    renderAll();
  });
});

function canAfford(action) {
  const p = currentPlayer();
  const cost = COSTS[action];
  return Object.entries(cost).every(([res, amt]) => (p.resources[res] || 0) >= amt);
}

function spendResources(action) {
  const p = currentPlayer();
  Object.entries(COSTS[action]).forEach(([res, amt]) => {
    p.resources[res] -= amt;
  });
}

// ── Canvas click handler ─────────────────────────────────────
document.getElementById('board-canvas').addEventListener('click', e => {
  const canvas = e.currentTarget;
  const rect   = canvas.getBoundingClientRect();
  const mx     = e.clientX - rect.left;
  const my     = e.clientY - rect.top;

  const size = getHexSize();

  if (G.phase === 'setup1' || G.phase === 'setup2') {
    handleSetupClick(mx, my, size);
    return;
  }

  if (G.phase === 'main') {
    if (G.activeAction === 'settlement') handleSettlementClick(mx, my);
    else if (G.activeAction === 'city')  handleCityClick(mx, my);
    else if (G.activeAction === 'road')  handleRoadClick(mx, my);
  }
});

// ── Setup phase ──────────────────────────────────────────────
// Track per-player setup state
let setupState = {}; // { settlementsPlaced: Map<playerIndex, count>, roadPhase: bool }

function initSetupState() {
  setupState = {
    pendingRoad: false,  // waiting for road placement after settlement
    lastSettlement: -1,  // vertex id of last placed settlement
  };
}

// Called after startGame builds board
(function() { initSetupState(); })();

function handleSetupClick(mx, my, size) {
  const v = nearestVertex(mx, my);
  if (!v) return;

  if (!setupState.pendingRoad) {
    // Try to place settlement
    if (!isVertexValidForSettlement(v)) return;
    placeSettlement(v);
    setupState.pendingRoad = true;
    setupState.lastSettlement = v.id;
    addLog(`${currentPlayer().name} placed a settlement.`);
    renderAll();
  } else {
    // Try to place road adjacent to last settlement
    const lastV = G.vertices[setupState.lastSettlement];
    const e = G.edges.find(ed =>
      ed.owner < 0 &&
      ((ed.v1 === setupState.lastSettlement && ed.v2 === v.id) ||
       (ed.v2 === setupState.lastSettlement && ed.v1 === v.id))
    );
    if (!e) {
      addLog('Place road adjacent to your new settlement.');
      return;
    }
    placeRoadFree(e);
    setupState.pendingRoad = false;
    addLog(`${currentPlayer().name} placed a road.`);

    // Setup round 2: give resources for free to second settlement
    if (G.phase === 'setup2') {
      const settled = G.vertices[setupState.lastSettlement];
      settled.adjacentHexes.forEach(tid => {
        const tile = G.tiles[tid];
        if (tile.terrain !== 'desert' && tile.number) {
          currentPlayer().resources[tile.terrain] = (currentPlayer().resources[tile.terrain] || 0) + 1;
        }
      });
    }

    advanceSetupTurn();
    renderAll();
  }
}

function advanceSetupTurn() {
  const n = G.numPlayers;
  G.setupSettlementsPlaced++;
  const total1 = n;     // after n settlements in setup1, switch to setup2 (reverse)
  const total2 = n * 2; // after n more, done

  if (G.phase === 'setup1') {
    if (G.setupSettlementsPlaced < total1) {
      G.currentPlayer = (G.currentPlayer + 1) % n;
    } else {
      G.phase = 'setup2';
      // stay on last player, reverse order next
    }
  } else if (G.phase === 'setup2') {
    const placed2 = G.setupSettlementsPlaced - total1;
    if (placed2 < total1) {
      G.currentPlayer = (G.currentPlayer - 1 + n) % n;
    } else {
      G.phase = 'main';
      G.currentPlayer = 0;
      addLog('Setup complete! Let the game begin. 🎉');
    }
  }
  addLog(`${currentPlayer().name}'s turn.`);
}

// ── Main phase placement ─────────────────────────────────────
function handleSettlementClick(mx, my) {
  const v = nearestVertex(mx, my);
  if (!v || !isVertexValidForSettlement(v) || !isVertexConnected(v)) return;
  spendResources('settlement');
  placeSettlement(v);
  G.activeAction = null;
  addLog(`${currentPlayer().name} built a settlement! 🏠`);
  checkWin();
  renderAll();
}

function handleCityClick(mx, my) {
  const v = nearestVertex(mx, my);
  if (!v || v.owner !== G.currentPlayer || v.type !== 'settlement') return;
  spendResources('city');
  upgradeToCity(v);
  G.activeAction = null;
  addLog(`${currentPlayer().name} built a city! 🏙️`);
  checkWin();
  renderAll();
}

function handleRoadClick(mx, my) {
  const e = nearestEdge(mx, my);
  if (!e || e.owner >= 0 || !isEdgeValidForRoad(e)) return;
  spendResources('road');
  placeRoadFree(e);
  G.activeAction = null;
  addLog(`${currentPlayer().name} built a road! 🛣️`);
  renderAll();
}

// ── Placement helpers ────────────────────────────────────────
function placeSettlement(v) {
  v.owner = G.currentPlayer;
  v.type  = 'settlement';
  currentPlayer().settlements.push(v.id);
}

function upgradeToCity(v) {
  v.type = 'city';
  const p = currentPlayer();
  p.settlements = p.settlements.filter(id => id !== v.id);
  p.cities.push(v.id);
}

function placeRoadFree(e) {
  e.owner = G.currentPlayer;
  currentPlayer().roads.push(edgeKey(e.v1, e.v2));
}

// ── Validation ───────────────────────────────────────────────
function isVertexValidForSettlement(v) {
  if (v.owner >= 0) return false;
  // Distance rule: no adjacent vertex can have a settlement
  return v.adjacentVertices.every(nid => G.vertices[nid].owner < 0);
}

function isVertexConnected(v) {
  // Must have a road adjacent belonging to current player
  return G.edges.some(e =>
    e.owner === G.currentPlayer &&
    (e.v1 === v.id || e.v2 === v.id)
  );
}

function isEdgeValidForRoad(e) {
  const pi = G.currentPlayer;
  if (e.owner >= 0) return false;
  // Must connect to current player's existing road or settlement
  return [e.v1, e.v2].some(vid => {
    const v = G.vertices[vid];
    if (v.owner === pi) return true; // settlement/city
    return G.edges.some(ed =>
      ed.owner === pi &&
      (ed.v1 === vid || ed.v2 === vid)
    );
  });
}

// ── Nearest vertex/edge ──────────────────────────────────────
function nearestVertex(mx, my) {
  let best = null, bestDist = Infinity;
  G.vertices.forEach(v => {
    const d = Math.hypot(v.x - mx, v.y - my);
    if (d < bestDist) { bestDist = d; best = v; }
  });
  const threshold = getHexSize() * 0.35;
  return bestDist < threshold ? best : null;
}

function nearestEdge(mx, my) {
  let best = null, bestDist = Infinity;
  G.edges.forEach(e => {
    const v1 = G.vertices[e.v1];
    const v2 = G.vertices[e.v2];
    const d  = pointToSegmentDist(mx, my, v1.x, v1.y, v2.x, v2.y);
    if (d < bestDist) { bestDist = d; best = e; }
  });
  const threshold = getHexSize() * 0.25;
  return bestDist < threshold ? best : null;
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}

// ── Trade ────────────────────────────────────────────────────
function populateTradeSelects() {
  [document.getElementById('trade-give'), document.getElementById('trade-get')].forEach(sel => {
    sel.innerHTML = '';
    RESOURCES.forEach(res => {
      const opt = document.createElement('option');
      opt.value       = res;
      opt.textContent = `${RESOURCE_EMOJI[res]} ${res}`;
      sel.appendChild(opt);
    });
  });
  document.getElementById('trade-get').value = 'ore';
}

document.getElementById('trade-btn').addEventListener('click', () => {
  if (G.phase !== 'main' || !G.diceRolled) return;
  const give = document.getElementById('trade-give').value;
  const get  = document.getElementById('trade-get').value;
  if (give === get) { addLog('Cannot trade a resource for itself.'); return; }
  const p = currentPlayer();
  if ((p.resources[give] || 0) < 4) {
    addLog(`Need 4× ${give} to trade. You have ${p.resources[give] || 0}.`);
    return;
  }
  p.resources[give] -= 4;
  p.resources[get]   = (p.resources[get] || 0) + 1;
  addLog(`${p.name} traded 4× ${RESOURCE_EMOJI[give]} → 1× ${RESOURCE_EMOJI[get]}`);
  renderAll();
});

// ── End Turn ─────────────────────────────────────────────────
document.getElementById('end-turn-btn').addEventListener('click', () => {
  if (G.phase !== 'main' || !G.diceRolled) return;
  G.diceRolled  = false;
  G.diceValues  = [0, 0];
  G.activeAction = null;
  document.getElementById('die1').textContent = '?';
  document.getElementById('die2').textContent = '?';

  G.currentPlayer = (G.currentPlayer + 1) % G.numPlayers;
  addLog(`${currentPlayer().name}'s turn.`);
  renderAll();
});

// ── Win condition ────────────────────────────────────────────
function checkWin() {
  updateVP();
  const winner = G.players.find(p => p.vp >= 10);
  if (!winner) return;

  showScreen('win-screen');
  document.getElementById('win-message').textContent = `${winner.name} wins! 🎉`;
  document.getElementById('win-message').style.color = winner.colour;

  const scores = G.players
    .slice()
    .sort((a, b) => b.vp - a.vp)
    .map(p => `<div style="color:${p.colour}">${p.name}: ${p.vp} VP</div>`)
    .join('');
  document.getElementById('final-scores').innerHTML = scores;
}

document.getElementById('play-again-btn').addEventListener('click', () => {
  showScreen('setup-screen');
});

// ── Utility ──────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function currentPlayer() {
  return G.players[G.currentPlayer];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Canvas resize ────────────────────────────────────────────
function resizeCanvas() {
  const canvas = document.getElementById('board-canvas');
  const parent = canvas.parentElement;
  canvas.width  = parent.clientWidth - 240; // minus side panel
  canvas.height = parent.clientHeight;
}

window.addEventListener('resize', () => {
  if (G.tiles) {
    renderCanvas();
  }
});
