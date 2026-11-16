/* Reversi Prime — app shell, screens, match orchestration, online protocol. */

import {
  EMPTY, BLACK, WHITE, SIZE, initialBoard, legalMoves, playMove, isGameOver,
  score, opponent, moveToNotation,
} from './engine.js';
import { chooseMove, DIFFICULTIES } from './ai.js';
import {
  getProfile, createProfile, updateProfile, getSettings, updateSettings,
  getCareer, recordMatch, levelInfo, rankOf, getMissions, claimMission,
  getFriends, getRequests, addFriendRequest, acceptFriend, declineFriend,
  addFriendDirect, removeFriend, isFriend, avatarList, subscribe,
} from './store.js';
import * as net from './net.js';
import { sfx, setSound } from './audio.js';

/* ---------- tiny helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DM_KEY = 'reversi.dms.v1';
function loadDMs() {
  try { return JSON.parse(localStorage.getItem(DM_KEY)) || {}; } catch { return {}; }
}
function saveDMs(dms) {
  try { localStorage.setItem(DM_KEY, JSON.stringify(dms)); } catch { /* noop */ }
}

/* ---------- session state ---------- */

const session = {
  screen: 'home',
  match: null,
  dms: loadDMs(),
  activeDM: null,
  incomingInvite: null,
  room: null,
  onlineFoe: null,
  onlineFoeEntry: null,
  presenceProfiles: {},
  aiThinking: false,
};

/* ---------- toasts ---------- */

function toast(msg, { icon: ic = 'check', error = false, ms = 3200 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* ---------- modals ---------- */

function openModal(html, { label = 'Dialog' } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="scrim" data-close></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  root.classList.add('open');
  const focusable = $('.modal [data-autofocus]', root) || $('.modal button, .modal input', root);
  if (focusable) focusable.focus();
}
function closeModal() {
  const root = $('#modal-root');
  root.classList.remove('open');
  root.innerHTML = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').classList.contains('open')) closeModal();
});

/* ---------- router ---------- */

const SCREENS = ['home', 'game', 'career', 'friends', 'missions', 'profile', 'room', 'onboard'];

function navItems() {
  return [
    { id: 'home', icon: 'grid', label: 'Play' },
    { id: 'career', icon: 'trophy', label: 'Career' },
    { id: 'friends', icon: 'users', label: 'Friends' },
    { id: 'missions', icon: 'target', label: 'Missions' },
    { id: 'profile', icon: 'user', label: 'Profile' },
  ];
}

function renderNav() {
  const reqs = getRequests().length;
  $('#bottomnav').innerHTML = navItems().map((n) => `
    <button data-nav="${n.id}" class="${session.screen === n.id ? 'active' : ''}" aria-label="${n.label}">
      ${icon(n.icon)}
      <span>${n.label}</span>
      ${n.id === 'friends' && reqs > 0 ? `<span class="nav-badge" aria-label="${reqs} pending requests">${reqs}</span>` : ''}
    </button>`).join('');
}

function showScreen(id) {
  if (!SCREENS.includes(id)) id = 'home';
  session.screen = id;
  $$('.screen').forEach((s) => s.classList.remove('active'));
  const el = $(`#screen-${id}`);
  if (el) el.classList.add('active');
  if (id !== 'game') $('#topbar').hidden = false;
  renderNav();
  const renderers = {
    home: renderHome, career: renderCareer, friends: renderFriends,
    missions: renderMissions, profile: renderProfile, room: renderRoom,
    game: () => {},
    onboard: () => {},
  };
  renderers[id]?.();
  window.scrollTo({ top: 0 });
}

function route() {
  const hash = location.hash.replace('#/', '') || 'home';
  showScreen(hash === 'game' ? 'game' : hash);
}
window.addEventListener('hashchange', route);

function go(id) {
  if (location.hash === `#/${id}`) showScreen(id);
  else location.hash = `#/${id}`;
}

/* ---------- topbar ---------- */

function renderTopbar() {
  const p = getProfile();
  if (!p) return;
  const c = getCareer();
  const lvl = levelInfo(c.xp);
  $('#chip-avatar').textContent = p.name.charAt(0).toUpperCase();
  $('#chip-avatar').className = `avatar ${p.avatar.startsWith('v') ? p.avatar : ''}`;
  $('#chip-name').textContent = p.name;
  $('#chip-level').textContent = `LV ${lvl.level} · ${lvl.pct}%`;
  const sound = getSettings().sound;
  $('#btn-sound').setAttribute('aria-pressed', String(sound));
  $('#btn-sound').innerHTML = icon(sound ? 'volume' : 'volume-off');
  $('#presence-dot').classList.toggle('online', net.isPresenceOnline());
}

/* ---------- onboarding ---------- */

function renderOnboard() {
  $('#topbar').hidden = true;
  $('#bottomnav').innerHTML = '';
  const avatars = avatarList();
  $('#screen-onboard').innerHTML = `
    <div class="onboard">
      <div class="hero-discs" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <h1>REVERSI<em>PRIME</em></h1>
        <p class="tag">The classic disc-flipping strategy game — rebuilt as a premium competitive experience. Local duels, AI opponents, online matches with friends, career progression and daily missions.</p>
      </div>
      <form id="onboard-form" novalidate>
        <div class="field" id="f-name">
          <label for="ob-name">Choose your call sign</label>
          <input id="ob-name" name="name" maxlength="16" autocomplete="nickname" placeholder="e.g. DiskWizard" data-autofocus>
          <span class="error">Pick a name with at least 2 characters.</span>
        </div>
        <div class="field">
          <label>Pick your avatar</label>
          <div class="avatar-picker" role="radiogroup" aria-label="Avatar">
            ${avatars.map((a, i) => `
              <button type="button" role="radio" aria-checked="${i === 0}" data-avatar="${a}" class="${i === 0 ? 'selected' : ''}">
                <span class="avatar ${a}">${String.fromCharCode(65 + i)}</span>
              </button>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">${icon('zap')} Enter the arena</button>
        <p class="hint" style="text-align:center">Your Player ID is generated automatically — friends add you with it. Everything is stored on this device.</p>
      </form>
    </div>`;

  let chosen = avatars[0];
  $$('.avatar-picker button').forEach((b) => b.addEventListener('click', () => {
    $$('.avatar-picker button').forEach((x) => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); });
    b.classList.add('selected');
    b.setAttribute('aria-checked', 'true');
    chosen = b.dataset.avatar;
    sfx.tap();
  }));

  $('#onboard-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#ob-name').value.trim();
    const field = $('#f-name');
    if (name.length < 2) {
      field.classList.add('invalid');
      $('#ob-name').focus();
      return;
    }
    field.classList.remove('invalid');
    createProfile(name, chosen);
    sfx.mission();
    boot();
    toast(`Welcome to the arena, ${name}!`, { icon: 'crown' });
  });
}

/* ---------- home ---------- */

function renderHome() {
  const p = getProfile();
  const c = getCareer();
  const lvl = levelInfo(c.xp);
  const rank = rankOf(c.rating);
  const winRate = c.games ? Math.round((c.wins / c.games) * 100) : 0;
  const diff = getSettings().lastDifficulty || 'medium';

  $('#screen-home').innerHTML = `
    <div class="hero">
      <h1>GOOD ${greeting()}, <em>${esc(p.name.toUpperCase())}</em></h1>
      <p>Flip discs, trap corners, dominate the board. Every match earns XP toward your next rank.</p>
      <div class="stats-row">
        <div class="stat-pill">${icon('trophy')}<div><b>${c.rating}</b><span>${rank.name} rating</span></div></div>
        <div class="stat-pill">${icon('zap')}<div><b>${winRate}%</b><span>win rate</span></div></div>
        <div class="stat-pill">${icon('flame')}<div><b>${c.streak}</b><span>win streak</span></div></div>
        <div class="stat-pill">${icon('shield')}<div><b>LV ${lvl.level}</b><span>${lvl.into}/${lvl.step} XP</span></div></div>
      </div>
    </div>

    <h2 class="section-title">${icon('play')} Game modes</h2>
    <div class="mode-grid">
      <button class="mode-card green" data-action="local">
        <span class="m-icon">${icon('swords', 'icon icon-lg')}</span>
        <h3>LOCAL DUEL</h3>
        <p>Pass &amp; play on one device. Two players, one board, no mercy.</p>
        <span class="go">Start match ${icon('arrow-up', 'icon icon-sm')}</span>
      </button>
      <button class="mode-card" data-action="ai" id="card-ai">
        <span class="m-icon">${icon('cpu', 'icon icon-lg')}</span>
        <h3>VS AI</h3>
        <p>Four engineered opponents — from Rookie to Grandmaster.</p>
        <span class="go">Configure ${icon('arrow-up', 'icon icon-sm')}</span>
      </button>
      <button class="mode-card pink" data-action="online">
        <span class="m-icon">${icon('globe', 'icon icon-lg')}</span>
        <h3>ONLINE</h3>
        <p>Host a room, share the code, or challenge a friend directly.</p>
        <span class="go">Go online ${icon('arrow-up', 'icon icon-sm')}</span>
      </button>
    </div>

    <div id="ai-config" style="display:none">
      <h2 class="section-title">${icon('cpu')} AI setup</h2>
      <div class="card">
        <div class="field"><label>Difficulty</label>
          <div class="diff-row" role="radiogroup" aria-label="Difficulty">
            ${Object.entries(DIFFICULTIES).map(([k, v]) => `
              <button class="chip ${k === diff ? 'selected' : ''}" data-diff="${k}" role="radio" aria-checked="${k === diff}">${v.label}</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-top:14px"><label>Your color</label>
          <div class="diff-row" role="radiogroup" aria-label="Your color">
            <button class="chip selected" data-color="${BLACK}">Black — first move</button>
            <button class="chip" data-color="${WHITE}">White — second move</button>
          </div>
        </div>
        <div style="margin-top:16px"><button class="btn btn-primary btn-block" data-action="ai-start">${icon('play')} Start match</button></div>
      </div>
    </div>

    <h2 class="section-title">${icon('globe')} Online lobby</h2>
    <div class="card">
      <div class="inline-actions" style="margin-bottom:14px">
        <button class="btn btn-primary" data-action="host">${icon('plus')} Create room</button>
        <button class="btn btn-ghost" data-action="invite-friend">${icon('user-plus')} Challenge a friend</button>
      </div>
      <div class="join-row">
        <input id="join-code" maxlength="8" placeholder="CODE" aria-label="Room code">
        <button class="btn btn-primary" data-action="join">${icon('link')} Join</button>
      </div>
      <p class="hint" style="margin-top:10px">Rooms are peer-to-peer — share the code or link with anyone. No account server, no waiting queue.</p>
    </div>

    <h2 class="section-title">${icon('target')} Daily missions</h2>
    <div id="home-missions"></div>`;

  renderHomeMissions();

  const aiConfig = $('#ai-config');
  $$('[data-action="ai"]').forEach((b) => b.addEventListener('click', () => {
    aiConfig.style.display = aiConfig.style.display === 'none' ? 'block' : 'none';
    if (aiConfig.style.display === 'block') aiConfig.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sfx.tap();
  }));

  let aiDiff = diff;
  let myColor = BLACK;
  $$('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-diff]').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    aiDiff = b.dataset.diff;
    sfx.tap();
  }));
  $$('[data-color]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-color]').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    myColor = Number(b.dataset.color);
    sfx.tap();
  }));

  $('#screen-home').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'local') startLocal();
    if (a === 'ai-start') { updateSettings({ lastDifficulty: aiDiff }); startAI(aiDiff, myColor); }
    if (a === 'host') hostRoomFlow();
    if (a === 'join') joinRoomFlow($('#join-code').value);
    if (a === 'invite-friend') { go('friends'); toast('Pick a friend to challenge', { icon: 'users' }); }
  });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'MORNING' : h < 18 ? 'AFTERNOON' : 'EVENING';
}

function missionRow(m) {
  const done = m.progress >= m.target;
  return `
    <div class="mission-row ${done ? 'done' : ''}">
      <span class="m-ic">${icon(done ? 'check' : 'target')}</span>
      <div class="m-body">
        <b>${esc(m.text.replace('{n}', m.n || m.target))}</b>
        <div class="progress ${done ? '' : 'violet'}"><i style="width:${Math.round((m.progress / m.target) * 100)}%"></i></div>
      </div>
      <div class="m-xp"><b>+${m.xp}</b><span>XP</span></div>
      ${done && !m.claimed
        ? `<button class="btn btn-primary btn-sm" data-claim="${m.id}">Claim</button>`
        : m.claimed ? `<span class="badge win">Claimed</span>` : ''}
    </div>`;
}

function renderHomeMissions() {
  const box = $('#home-missions');
  if (!box) return;
  box.innerHTML = getMissions().map(missionRow).join('');
  $$('[data-claim]', box).forEach((b) => b.addEventListener('click', () => {
    const res = claimMission(b.dataset.claim);
    if (res) {
      sfx.mission();
      toast(`Mission complete — +${res.xp} XP`, { icon: 'target' });
      renderTopbar();
      renderHomeMissions();
    }
  }));
}

/* ---------- match engine wiring ---------- */

function newMatch({ mode, difficulty = null, myColor = BLACK, foe = null }) {
  session.match = {
    mode, difficulty, myColor, foe,
    board: initialBoard(),
    turn: BLACK,
    history: [],
    lastMove: null,
    over: false,
    myFlips: 0,
    myCorners: 0,
  };
}

function myTurn() {
  const m = session.match;
  if (!m || m.over) return false;
  if (m.mode === 'local') return true;
  return m.turn === m.myColor;
}

function startLocal() {
  newMatch({ mode: 'local' });
  session.match.foe = { name: 'Player 2', avatar: 'v2' };
  enterGame();
}

function startAI(difficulty, myColor) {
  const names = { easy: 'Rookie-9', medium: 'Challenger-X', hard: 'Master-1', expert: 'Grandmaster' };
  newMatch({ mode: 'ai', difficulty, myColor });
  session.match.foe = { name: names[difficulty] || 'AI', avatar: 'v3' };
  enterGame();
  scheduleAI();
}

function enterGame() {
  go('game');
  $('#topbar').hidden = true;
  buildGameScreen();
  renderGame();
}

function playerNameFor(color) {
  const m = session.match;
  const p = getProfile();
  if (m.mode === 'local') return color === BLACK ? p.name : 'Player 2';
  return color === m.myColor ? p.name : (m.foe?.name || 'Opponent');
}

function buildGameScreen() {
  const m = session.match;
  const online = m.mode === 'online';
  $('#screen-game').innerHTML = `
    <div class="game-layout">
      <div class="game-col">
        ${playerCardHTML(WHITE)}
        <div class="side-block">
          ${online ? chatPanelHTML() : ''}
        </div>
      </div>
      <div class="board-shell">
        <div class="game-top">
          ${playerCardHTML(WHITE)}
          <div class="turn-banner" id="turn-banner" role="status"></div>
        </div>
        <div class="board" id="board" role="grid" aria-label="Reversi board"></div>
        <div class="game-toolbar" id="game-toolbar"></div>
        <div class="game-side-mobile">
          ${online ? chatPanelHTML() : ''}
        </div>
      </div>
      <div class="game-col">
        ${playerCardHTML(BLACK)}
        <div class="side-block">
          <div class="card"><div class="conn-status" id="conn-line"></div></div>
        </div>
      </div>
    </div>`;
  buildBoardDom();
  $('#screen-game').addEventListener('click', onGameClick);
  $('#screen-game').addEventListener('keydown', onGameKeydown);
  if (online) wireChat();
}

function playerCardHTML(color) {
  return `
    <div class="player-card" id="pc-${color}">
      <span class="mini-disc ${color === BLACK ? 'black' : 'white'}" aria-hidden="true"></span>
      <div class="p-meta">
        <div class="p-name"><span class="nm"></span></div>
        <div class="p-sub"></div>
      </div>
      <div class="p-score">2</div>
    </div>`;
}

function buildBoardDom() {
  const board = $('#board');
  board.innerHTML = '';
  board.className = `board theme-${getSettings().boardTheme || 'emerald'}`;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.i = i;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `${moveToNotation(i)} empty`);
    board.appendChild(cell);
  }
}

function discEl(color, fresh) {
  const d = document.createElement('span');
  d.className = `disc is-${color === BLACK ? 'black' : 'white'}${fresh ? ' pop' : ''}`;
  d.innerHTML = `<span class="face b"></span><span class="face w"></span>`;
  return d;
}

function renderGame(freshIdx = null) {
  const m = session.match;
  if (!m) return;
  const s = score(m.board);
  const legal = myTurn() ? new Set(legalMoves(m.board, m.turn)) : new Set();

  $$('#board .cell').forEach((cell) => {
    const i = Number(cell.dataset.i);
    const v = m.board[i];
    let disc = cell.querySelector('.disc');
    if (v === EMPTY) {
      if (disc) disc.remove();
      cell.classList.toggle('legal', legal.has(i));
      cell.setAttribute('aria-label', legal.has(i) ? `${moveToNotation(i)} — playable` : `${moveToNotation(i)} empty`);
      cell.disabled = !legal.has(i);
      return;
    }
    cell.classList.remove('legal');
    cell.disabled = true;
    const cls = v === BLACK ? 'is-black' : 'is-white';
    if (!disc) {
      disc = discEl(v, i === freshIdx);
      cell.appendChild(disc);
    } else if (!disc.classList.contains(cls)) {
      disc.classList.remove('is-black', 'is-white');
      disc.classList.add(cls);
    } else if (i === freshIdx) {
      disc.classList.remove('pop');
      void disc.offsetWidth;
      disc.classList.add('pop');
    }
    cell.setAttribute('aria-label', `${moveToNotation(i)} ${v === BLACK ? 'black' : 'white'} disc`);
  });

  $$('#board .cell.last').forEach((c) => c.classList.remove('last'));
  if (m.lastMove != null) $(`#board .cell[data-i="${m.lastMove}"]`)?.classList.add('last');

  for (const color of [BLACK, WHITE]) {
    const card = $(`#pc-${color}`);
    if (!card) continue;
    card.classList.toggle('turn', !m.over && m.turn === color);
    $('.nm', card).textContent = playerNameFor(color);
    $('.p-sub', card).textContent = color === BLACK ? 'Black · moves first' : 'White';
    $('.p-score', card).textContent = color === BLACK ? s.black : s.white;
  }

  const banner = $('#turn-banner');
  if (banner) {
    if (m.over) banner.innerHTML = `${icon('flag')} Match over`;
    else if (m.mode === 'ai' && m.turn !== m.myColor && session.aiThinking) banner.innerHTML = `${icon('cpu')} ${esc(playerNameFor(m.turn))} is thinking…`;
    else if (m.mode === 'local') banner.innerHTML = `${icon('play')} <b>${esc(playerNameFor(m.turn))}</b> — your move`;
    else if (m.turn === m.myColor) banner.innerHTML = `${icon('zap')} Your move`;
    else banner.innerHTML = `${icon('cpu')} Waiting for <b>${esc(playerNameFor(m.turn))}</b>…`;
  }

  renderToolbar();
  renderConnLine();
}

function renderConnLine() {
  const el = $('#conn-line');
  if (!el || !session.match || session.match.mode !== 'online') return;
  const online = session.onlineFoe && net.isConnected(session.onlineFoe);
  el.className = `conn-status ${online ? 'online' : ''}`;
  el.innerHTML = online
    ? `${icon('check', 'icon icon-sm')} Peer connection active`
    : `${icon('wifi-off', 'icon icon-sm')} Peer connection lost`;
}

function renderToolbar() {
  const m = session.match;
  const bar = $('#game-toolbar');
  if (!bar) return;
  const online = m.mode === 'online';
  bar.innerHTML = `
    ${!online ? `<button class="tool-btn" data-tool="undo" ${m.history.length === 0 || m.over ? 'disabled' : ''}>${icon('undo')} Undo</button>` : ''}
    ${!online && !m.over ? `<button class="tool-btn" data-tool="hint">${icon('bulb')} Hint</button>` : ''}
    ${!m.over ? `<button class="tool-btn danger" data-tool="resign">${icon('flag')} ${online ? 'Forfeit' : 'End match'}</button>` : ''}
    <button class="tool-btn" data-tool="exit">${icon('back')} Exit</button>`;
}

function onGameClick(e) {
  const cell = e.target.closest('.cell');
  if (cell && !cell.disabled) {
    attemptMove(Number(cell.dataset.i));
    return;
  }
  const tool = e.target.closest('[data-tool]');
  if (tool) handleTool(tool.dataset.tool);
  const emote = e.target.closest('[data-emote]');
  if (emote) sendEmote(emote.dataset.emote);
  if (e.target.closest('[data-send-chat]')) sendChatInput();
  if (e.target.closest('[data-rematch]')) requestRematch();
}

function onGameKeydown(e) {
  if (e.key === 'Enter' && e.target.matches('.chat-input-row input')) sendChatInput();
}

function handleTool(t) {
  const m = session.match;
  if (!m) return;
  if (t === 'exit') {
    confirmModal('Leave this match?', 'Progress will not be recorded if you leave now.', 'Leave', () => {
      if (m.mode === 'online') netDropAll();
      go('home');
    });
    return;
  }
  if (t === 'resign') {
    if (m.mode === 'online') {
      if (net.isConnected(session.onlineFoe)) net.send(session.onlineFoe, { t: 'resign' });
      finishByForfeit();
    } else {
      confirmModal('End the match?', 'The current position will be scored as-is.', 'End match', () => {
        const s = score(m.board);
        finishMatch(s.black, s.white, {});
      });
    }
    return;
  }
  if (t === 'hint' && myTurn()) {
    const best = chooseMove(m.board, m.turn, 'hard');
    if (best != null) {
      const cell = $(`#board .cell[data-i="${best}"]`);
      cell.classList.add('last');
      setTimeout(() => cell.classList.remove('last'), 1400);
      sfx.tap();
    }
    return;
  }
  if (t === 'undo' && !m.over && m.history.length > 0) {
    let steps = 1;
    if (m.mode === 'ai' && m.history.length >= 2 && m.history[m.history.length - 1].player !== m.myColor) steps = 2;
    m.history.splice(m.history.length - steps, steps);
    let b = initialBoard();
    for (const h of m.history) {
      const played = playMove(b, h.idx, h.player);
      b = played ? played.board : b;
    }
    m.board = b;
    m.turn = m.history.length ? opponent(m.history[m.history.length - 1].player) : BLACK;
    m.lastMove = m.history.length ? m.history[m.history.length - 1].idx : null;
    renderGame();
    sfx.tap();
    scheduleAI();
  }
}

function attemptMove(i) {
  const m = session.match;
  if (!m || m.over || !myTurn()) return;
  if (!isMoveLegal(m.board, i, m.turn)) { sfx.invalid(); return; }
  commitMove(i, m.turn);
  if (m.mode === 'online' && net.isConnected(session.onlineFoe)) {
    net.send(session.onlineFoe, { t: 'move', idx: i });
  }
  scheduleAI();
}

function isMoveLegal(board, i, player) {
  return legalMoves(board, player).includes(i);
}

function commitMove(i, player, { fresh = true } = {}) {
  const m = session.match;
  const played = playMove(m.board, i, player);
  if (!played) return false;
  m.board = played.board;
  m.turn = played.turn;
  m.lastMove = i;
  m.history.push({ idx: i, player, flips: played.flips.length });

  if (m.mode === 'local' || player === m.myColor) {
    m.myFlips += played.flips.length;
    if ([0, 7, 56, 63].includes(i) || played.flips.some((f) => [0, 7, 56, 63].includes(f))) m.myCorners += 1;
  }

  sfx.place();
  setTimeout(() => sfx.flip(), 120);
  renderGame(fresh ? i : null);

  if (played.passed && !played.over) {
    toast(`${playerNameFor(played.turn)} has no legal move — play again!`, { icon: 'refresh' });
  }
  if (played.over || isGameOver(m.board)) {
    const s = score(m.board);
    finishMatch(s.black, s.white, {});
  }
  return true;
}

function scheduleAI() {
  const m = session.match;
  if (!m || m.mode !== 'ai' || m.over) return;
  if (m.turn === m.myColor) return;
  session.aiThinking = true;
  renderGame();
  setTimeout(() => {
    if (!session.match || session.match !== m || m.over) { session.aiThinking = false; return; }
    const move = chooseMove(m.board, m.turn, m.difficulty);
    session.aiThinking = false;
    if (move != null) commitMove(move, m.turn);
  }, 480 + Math.random() * 500);
}

function finishMatch(myScoreVal, foeScoreVal, { forfeit = false, remote = false } = {}) {
  const m = session.match;
  if (!m || m.over) return;
  m.over = true;

  let my = myScoreVal;
  let foe = foeScoreVal;
  if (m.mode !== 'local' && m.myColor === WHITE) { my = foeScoreVal; foe = myScoreVal; }

  const res = recordMatch({
    mode: m.mode,
    difficulty: m.difficulty,
    opponentName: m.mode === 'local' ? 'Player 2' : (m.foe?.name || 'Opponent'),
    myScore: my,
    foeScore: foe,
    flipped: m.myFlips,
    corners: m.myCorners,
  });

  const iWon = my > foe;
  const draw = my === foe;
  if (draw) sfx.message();
  else if (iWon) sfx.win();
  else sfx.lose();

  renderTopbar();
  renderGame();
  showResultModal({ my, foe, res, iWon, draw, forfeit, remote, mode: m.mode });
}

function finishByForfeit() {
  const m = session.match;
  if (!m || m.over) return;
  const s = score(m.board);
  const my = m.myColor === BLACK ? s.black : s.white;
  const foe = m.myColor === BLACK ? s.white : s.black;
  finishMatch(Math.min(my, foe), foe + 1, { forfeit: true });
}

function showResultModal({ my, foe, res, iWon, draw, forfeit, remote, mode }) {
  const online = mode === 'online';
  openModal(`
    <div class="result-banner ${draw ? 'draw' : iWon ? 'win' : 'loss'}">
      <div class="big">${draw ? 'DRAW' : iWon ? 'VICTORY' : 'DEFEAT'}</div>
      <p class="sub">${forfeit ? 'Decided by forfeit' : remote ? 'Your opponent ended the match' : 'Final board position'}</p>
    </div>
    <div class="result-players">
      <div class="rp"><b>${my}</b><span>You</span></div>
      <span class="vs">VS</span>
      <div class="rp"><b>${foe}</b><span>${esc(mode === 'local' ? 'Player 2' : (session.match.foe?.name || 'Opponent'))}</span></div>
    </div>
    <div class="xp-line">${icon('zap')} <b>+${res.xpGain}</b> XP
      <span class="badge ${res.ratingDelta > 0 ? 'win' : res.ratingDelta < 0 ? 'loss' : 'draw'}">
        ${res.ratingDelta > 0 ? '+' : ''}${res.ratingDelta} RP
      </span>
    </div>
    <div class="modal-actions">
      ${online
        ? `<button class="btn btn-primary" data-rematch>${icon('refresh')} Rematch</button>`
        : `<button class="btn btn-primary" data-again>${icon('refresh')} ${mode === 'local' ? 'New duel' : 'Rematch'}</button>`}
      <button class="btn btn-ghost" data-home>${icon('home')} Home</button>
    </div>`,
    { label: 'Match result' });

  $('.modal [data-home]').addEventListener('click', () => {
    closeModal();
    if (session.match?.mode === 'online') netDropAll();
    go('home');
  });
  const again = $('.modal [data-again]');
  if (again) again.addEventListener('click', () => {
    closeModal();
    const m = session.match;
    if (m.mode === 'local') startLocal();
    else startAI(m.difficulty, m.myColor);
  });
}

function confirmModal(title, sub, confirmLabel, onConfirm) {
  openModal(`
    <h2>${esc(title)}</h2>
    <p class="sub">${esc(sub)}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-danger" data-ok>${esc(confirmLabel)}</button>
    </div>`, { label: title });
  $('[data-cancel]').addEventListener('click', closeModal);
  $('[data-ok]').addEventListener('click', () => { closeModal(); onConfirm(); });
}

/* ---------- chat ---------- */

const EMOTES = ['👍', '🔥', '😂', '😮', '😎', '🤝', '💀', '⏰'];

function chatPanelHTML() {
  return `
    <div class="chat-panel" id="chat-panel">
      <div class="chat-head">${icon('chat')} Match chat
        <span style="margin-left:auto" class="conn-status" id="chat-conn"></span>
      </div>
      <div class="chat-log" id="chat-log" aria-live="polite"></div>
      <div class="emote-bar">
        ${EMOTES.map((e2) => `<button data-emote="${e2}" aria-label="Send ${e2}"><span class="em">${e2}</span></button>`).join('')}
      </div>
      <div class="chat-input-row">
        <input id="chat-input" maxlength="140" placeholder="Message…" aria-label="Chat message">
        <button class="icon-btn" data-send-chat aria-label="Send message">${icon('send')}</button>
      </div>
    </div>`;
}

function wireChat() {
  const log = $('#chat-log');
  if (!log) return;
  log.innerHTML = `<div class="chat-sys">Only you two can see this chat</div>`;
  renderConnLine();
}

function pushChat(text, { me = false, emote = false, sys = false } = {}) {
  const log = $('#chat-log');
  if (!log) return;
  const el = document.createElement('div');
  if (sys) {
    el.className = 'chat-sys';
    el.textContent = text;
  } else {
    el.className = `chat-msg${me ? ' me' : ''}${emote ? ' emote' : ''}`;
    el.innerHTML = `${me ? '' : `<div class="who">${esc(session.match?.foe?.name || 'Opponent')}</div>`}<div class="bubble">${esc(text)}</div>`;
  }
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function sendChatInput() {
  const input = $('#chat-input');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';
  pushChat(text, { me: true });
  if (session.match?.mode === 'online' && net.isConnected(session.onlineFoe)) {
    net.send(session.onlineFoe, { t: 'chat', text });
  }
}

function sendEmote(e2) {
  pushChat(e2, { me: true, emote: true });
  sfx.tap();
  if (session.match?.mode === 'online' && net.isConnected(session.onlineFoe)) {
    net.send(session.onlineFoe, { t: 'emote', emote: e2 });
  }
}

/* ---------- online: rooms ---------- */

function roomHandlers() {
  return {
    onConnection: (peerId) => {
      session.onlineFoe = session.onlineFoe || peerId;
      toast('Opponent connected!', { icon: 'users' });
      sfx.message();
    },
    onMessage: (peerId, msg) => handleNetMessage(peerId, msg),
    onClose: () => handleFoeDisconnect(),
  };
}

function handleFoeDisconnect() {
  if (session.match && session.match.mode === 'online' && !session.match.over) {
    openModal(`
      <h2>Opponent left</h2>
      <p class="sub">The peer connection dropped. Claim the win or head home.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" data-claimwin>Claim win</button>
        <button class="btn btn-ghost" data-goexit>Exit</button>
      </div>`, { label: 'Opponent left' });
    $('[data-claimwin]').addEventListener('click', () => { closeModal(); finishByForfeit(); });
    $('[data-goexit]').addEventListener('click', () => { closeModal(); netDropAll(); go('home'); });
  } else if (session.room) {
    toast('Room closed', { icon: 'wifi-off' });
  }
}

async function hostRoomFlow() {
  const p = getProfile();
  if (!p) return;
  if (session.room) { go('room'); return; }
  const code = net.makeRoomCode();
  toast('Opening room…', { icon: 'globe' });
  try {
    await net.hostRoom(code, roomHandlers());
    session.room = { code, role: 'host' };
    sfx.message();
    go('room');
  } catch (err) {
    toast(err.message || 'Could not open the room', { icon: 'wifi-off', error: true });
  }
}

function joinRoomFlow(rawCode) {
  const code = net.normalizeCode(rawCode);
  if (code.length < 4) {
    toast('Enter the 6-character room code', { icon: 'x', error: true });
    return;
  }
  joinWithCode(code);
}

async function joinWithCode(code) {
  const p = getProfile();
  toast('Joining room…', { icon: 'globe' });
  try {
    await net.ensurePresence(p.id, presenceHandlers());
    const conn = await net.joinRoom(code, roomHandlers());
    session.room = { code, role: 'guest' };
    session.onlineFoe = conn.peer;
    conn.send({ t: 'hello', profile: publicProfile() });
    go('room');
    toast('Connected — waiting for the host to start', { icon: 'check' });
  } catch (err) {
    toast(err.message || 'Could not join the room', { icon: 'wifi-off', error: true });
  }
}

function renderRoom() {
  const r = session.room;
  if (!r) { go('home'); return; }
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  const foeHere = session.onlineFoe && net.isConnected(session.onlineFoe);
  $('#screen-room').innerHTML = `
    <button class="tool-btn" data-exit-room>${icon('back')} Back</button>
    <div style="max-width:520px;margin:22px auto">
      <div class="card glass invite-pulse" style="text-align:center">
        <h2 style="font-size:26px;letter-spacing:.1em">${r.role === 'host' ? 'YOUR ROOM' : 'JOINED ROOM'}</h2>
        <div class="room-code-box">
          <span class="sub">Share this code with your friend</span>
          <code>${r.code}</code>
          <div class="inline-actions" style="justify-content:center;margin-top:12px">
            <button class="btn btn-ghost btn-sm" data-copy-code>${icon('copy')} Copy code</button>
            <button class="btn btn-ghost btn-sm" data-copy-link>${icon('link')} Copy invite link</button>
          </div>
        </div>
        <div class="conn-status ${foeHere ? 'online' : ''}" id="room-status" style="justify-content:center;margin-top:14px">
          ${foeHere ? `${icon('check')} ${esc(session.onlineFoeEntry?.name || 'Opponent')} connected` : r.role === 'host' ? `${icon('wifi-off')} Waiting for an opponent…` : `${icon('check')} Connected — waiting for start…`}
        </div>
        ${foeHere ? `
          <div style="margin-top:16px">
            <button class="btn btn-primary btn-block" data-start-match>${icon('play')} ${r.role === 'host' ? 'Start match' : 'Waiting for host…'}</button>
          </div>` : ''}
      </div>
    </div>`;

  $('[data-copy-code]')?.addEventListener('click', () => copyText(r.code, 'Room code copied'));
  $('[data-copy-link]')?.addEventListener('click', () => copyText(link, 'Invite link copied'));
  $('[data-exit-room]').addEventListener('click', () => {
    net.closeRoom();
    session.room = null;
    go('home');
  });
  const start = $('[data-start-match]');
  if (start && r.role === 'host') {
    start.addEventListener('click', () => {
      if (session.onlineFoe && net.isConnected(session.onlineFoe)) {
        net.send(session.onlineFoe, { t: 'match-start', hostColor: BLACK, foe: publicProfile() });
        startOnlineMatch(BLACK);
      }
    });
  }
}

function copyText(text, msg) {
  navigator.clipboard?.writeText(text).then(
    () => toast(msg, { icon: 'copy' }),
    () => toast('Copy failed — copy it manually', { icon: 'x', error: true }),
  );
}

function startOnlineMatch(myColor) {
  const foe = session.onlineFoeEntry || { name: 'Opponent', avatar: 'v4' };
  newMatch({ mode: 'online', myColor, foe });
  enterGame();
  pushChat('Match started — good luck!', { sys: true });
}

/* ---------- online: presence, friends, invites, DMs ---------- */

function publicProfile() {
  const p = getProfile();
  const c = getCareer();
  return { id: p.id, name: p.name, avatar: p.avatar, rating: c.rating, level: levelInfo(c.xp).level };
}

function presenceHandlers() {
  return {
    onConnection: () => {
      renderTopbar();
      if (session.screen === 'friends') renderFriends();
    },
    onMessage: (peerId, msg) => handlePresenceMessage(peerId, msg),
    onClose: (peerId) => {
      renderTopbar();
      if (session.screen === 'friends') renderFriends();
      const playerId = net.peerIdToPlayer(peerId);
      if (playerId && session.dms[playerId]) {
        session.dms[playerId].push({ sys: true, text: 'Friend went offline', at: Date.now() });
        saveDMs(session.dms);
      }
    },
  };
}

function handlePresenceMessage(peerId, msg) {
  if (!msg || typeof msg !== 'object') return;
  const fromId = net.peerIdToPlayer(peerId);
  switch (msg.t) {
    case 'hello': {
      if (msg.profile?.id) {
        session.presenceProfiles[msg.profile.id] = msg.profile;
        if (session.screen === 'friends') renderFriends();
      }
      break;
    }
    case 'friend-req': {
      if (msg.profile?.id && addFriendRequest(msg.profile)) {
        sfx.message();
        toast(`${msg.profile.name} sent a friend request`, { icon: 'user-plus', ms: 5000 });
        renderNav();
        if (session.screen === 'friends') renderFriends();
      }
      break;
    }
    case 'friend-accept': {
      if (msg.profile?.id && addFriendDirect(msg.profile)) {
        sfx.message();
        toast(`${msg.profile.name} accepted your request`, { icon: 'check' });
        if (session.screen === 'friends') renderFriends();
      }
      break;
    }
    case 'chat': {
      if (typeof msg.text !== 'string' || !msg.text) break;
      const pid = msg.profile?.id || fromId;
      session.dms[pid] = session.dms[pid] || [];
      session.dms[pid].push({ me: false, text: String(msg.text).slice(0, 140), at: Date.now() });
      if (session.dms[pid].length > 60) session.dms[pid] = session.dms[pid].slice(-60);
      saveDMs(session.dms);
      sfx.message();
      const friend = getFriends().find((f) => f.id === pid);
      if (session.activeDM === pid && $('#dm-log')) renderDMLog();
      else toast(`${friend?.name || 'A friend'}: ${msg.text.slice(0, 40)}`, { icon: 'chat' });
      break;
    }
    case 'emote': {
      const pid = msg.profile?.id || fromId;
      session.dms[pid] = session.dms[pid] || [];
      session.dms[pid].push({ me: false, text: String(msg.emote || '👍'), emote: true, at: Date.now() });
      saveDMs(session.dms);
      if (session.activeDM === pid && $('#dm-log')) renderDMLog();
      break;
    }
    case 'invite': {
      if (!msg.code || session.match) break;
      session.incomingInvite = { code: net.normalizeCode(msg.code), from: msg.profile || { name: 'A player' } };
      sfx.message();
      openModal(`
        <div class="result-banner win"><div class="big" style="font-size:30px">MATCH INVITE</div></div>
        <p class="sub" style="text-align:center"><b>${esc(session.incomingInvite.from.name)}</b> challenges you to a Reversi match.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-decline>Decline</button>
          <button class="btn btn-primary" data-accept>Join match</button>
        </div>`, { label: 'Match invite' });
      $('[data-decline]').addEventListener('click', () => {
        net.send(peerId, { t: 'invite-decline' });
        session.incomingInvite = null;
        closeModal();
      });
      $('[data-accept]').addEventListener('click', () => {
        const code = session.incomingInvite.code;
        session.incomingInvite = null;
        closeModal();
        joinWithCode(code);
      });
      break;
    }
    case 'invite-decline': {
      toast('Invite declined', { icon: 'x' });
      break;
    }
    default:
      break;
  }
}

function handleNetMessage(peerId, msg) {
  if (!msg || typeof msg !== 'object') return;
  const m = session.match;
  switch (msg.t) {
    case 'hello': {
      if (msg.profile) {
        session.onlineFoeEntry = msg.profile;
        if (session.match) { session.match.foe = msg.profile; renderGame(); }
        if (session.room?.role === 'host') {
          net.send(peerId, { t: 'hello', profile: publicProfile() });
        }
        if (session.screen === 'room') renderRoom();
      }
      break;
    }
    case 'match-start': {
      if (session.room?.role === 'guest') {
        session.onlineFoeEntry = msg.foe || session.onlineFoeEntry;
        startOnlineMatch(opponent(msg.hostColor ?? BLACK));
      }
      break;
    }
    case 'move': {
      if (m && m.mode === 'online' && !m.over && m.turn !== m.myColor) {
        if (Number.isInteger(msg.idx) && isMoveLegal(m.board, msg.idx, m.turn)) {
          commitMove(msg.idx, m.turn);
        }
      }
      break;
    }
    case 'chat': {
      if (typeof msg.text === 'string' && msg.text) pushChat(msg.text.slice(0, 140));
      break;
    }
    case 'emote': {
      pushChat(String(msg.emote || '👍'), { emote: true });
      break;
    }
    case 'resign': {
      if (m && m.mode === 'online' && !m.over) {
        const s = score(m.board);
        const my = m.myColor === BLACK ? s.black : s.white;
        const foe = m.myColor === BLACK ? s.white : s.black;
        finishMatch(my, foe + 1, { forfeit: true, remote: true });
      }
      break;
    }
    case 'rematch-req': {
      sfx.message();
      openModal(`
        <h2>Rematch?</h2>
        <p class="sub">${esc(session.match?.foe?.name || 'Your opponent')} wants a rematch.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-no>Not now</button>
          <button class="btn btn-primary" data-yes>Let's go</button>
        </div>`, { label: 'Rematch request' });
      $('[data-no]').addEventListener('click', () => {
        net.send(peerId, { t: 'rematch-decline' });
        closeModal();
      });
      $('[data-yes]').addEventListener('click', () => {
        closeModal();
        if (session.room?.role === 'host') {
          net.send(peerId, { t: 'match-start', hostColor: BLACK, foe: publicProfile() });
          startOnlineMatch(BLACK);
        }
      });
      break;
    }
    case 'rematch-decline': {
      toast('Rematch declined', { icon: 'x' });
      break;
    }
    default:
      break;
  }
}

function requestRematch() {
  if (session.match?.mode !== 'online') return;
  if (net.isConnected(session.onlineFoe)) {
    net.send(session.onlineFoe, { t: 'rematch-req' });
    toast('Rematch requested…', { icon: 'refresh' });
  } else {
    toast('Opponent is offline', { icon: 'wifi-off', error: true });
  }
}

function netDropAll() {
  if (session.onlineFoe) net.drop(session.onlineFoe);
  net.closeRoom();
  session.room = null;
  session.onlineFoe = null;
  session.onlineFoeEntry = null;
}

/* ---------- friends screen ---------- */

function friendStatus(f) {
  return net.isConnected(net.playerToPeerId(f.id)) ? 'online' : 'offline';
}

function renderFriends() {
  const p = getProfile();
  const friends = getFriends();
  const reqs = getRequests();
  $('#screen-friends').innerHTML = `
    <h2 class="section-title">${icon('user-plus')} Your player ID</h2>
    <div class="id-copy">
      <div><span>Share it so friends can add &amp; challenge you</span><code>${p.id}</code></div>
      <button class="icon-btn" data-copy-id aria-label="Copy player ID">${icon('copy')}</button>
    </div>
    <div class="conn-status" id="net-status" style="margin-top:10px">
      ${net.isPresenceOnline()
        ? `${icon('check', 'icon icon-sm')} Online — you can receive invites &amp; DMs`
        : `${icon('wifi-off', 'icon icon-sm')} Offline — <button class="chip" data-retry-net style="min-height:32px;padding:2px 10px">Retry</button>`}
    </div>

    <h2 class="section-title">${icon('plus')} Add a friend</h2>
    <div class="card">
      <div class="join-row">
        <input id="friend-id-input" placeholder="RVSI-XXXX-XXXX" aria-label="Friend player ID" style="letter-spacing:.08em">
        <button class="btn btn-primary" data-add-friend>${icon('user-plus')} Add</button>
      </div>
      <p class="hint" style="margin-top:8px">They'll get the request instantly if they're online.</p>
    </div>

    ${reqs.length ? `
      <h2 class="section-title">${icon('bell')} Requests (${reqs.length})</h2>
      ${reqs.map((r) => `
        <div class="friend-row">
          <span class="avatar ${r.avatar}">${esc(r.name.charAt(0).toUpperCase())}</span>
          <div class="f-meta"><b>${esc(r.name)}</b><span>${r.id}</span></div>
          <div class="f-actions">
            <button class="btn btn-primary btn-sm" data-accept-req="${r.id}">Accept</button>
            <button class="btn btn-ghost btn-sm" data-decline-req="${r.id}">Decline</button>
          </div>
        </div>`).join('')}` : ''}

    <h2 class="section-title">${icon('users')} Friends (${friends.length})</h2>
    ${friends.length === 0
      ? `<div class="empty">${icon('users')}<p>No friends yet. Add someone with their Player ID — then challenge them straight from here.</p></div>`
      : friends.map((f) => {
          const st = friendStatus(f);
          return `
          <div class="friend-row">
            <span class="avatar ${f.avatar}">${esc(f.name.charAt(0).toUpperCase())}</span>
            <div class="f-meta">
              <b>${esc(f.name)} <span class="status-dot ${st}" title="${st}"></span></b>
              <span>${f.id}</span>
            </div>
            <div class="f-actions">
              <button class="btn btn-primary btn-sm" data-invite="${f.id}" ${st === 'online' ? '' : 'disabled'}>${icon('swords', 'icon icon-sm')} Invite</button>
              <button class="icon-btn" data-dm="${f.id}" aria-label="Message ${esc(f.name)}" style="width:40px;height:40px">${icon('chat')}</button>
              <button class="icon-btn" data-remove="${f.id}" aria-label="Remove ${esc(f.name)}" style="width:40px;height:40px">${icon('x')}</button>
            </div>
          </div>`;
        }).join('')}`;

  $('[data-copy-id]').addEventListener('click', () => copyText(getProfile().id, 'Player ID copied'));

  $('[data-retry-net]')?.addEventListener('click', async () => {
    toast('Reconnecting…', { icon: 'refresh' });
    try {
      await net.ensurePresence(getProfile().id, presenceHandlers());
      renderTopbar();
      renderFriends();
      toast('Back online!', { icon: 'check' });
    } catch {
      toast('Still offline — check your connection', { icon: 'wifi-off', error: true });
    }
  });

  $('[data-add-friend]').addEventListener('click', () => addFriendFlow($('#friend-id-input').value));
  $('#friend-id-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFriendFlow($('#friend-id-input').value);
  });

  $$('[data-accept-req]').forEach((b) => b.addEventListener('click', async () => {
    const req = acceptFriend(b.dataset.acceptReq);
    if (req) {
      sfx.message();
      toast(`${req.name} is now your friend`, { icon: 'check' });
      try {
        await net.ensurePresence(getProfile().id, presenceHandlers());
        net.send(net.playerToPeerId(req.id), { t: 'friend-accept', profile: publicProfile() });
      } catch { /* offline — accept stored locally */ }
      renderNav();
      renderFriends();
    }
  }));

  $$('[data-decline-req]').forEach((b) => b.addEventListener('click', () => {
    declineFriend(b.dataset.declineReq);
    renderNav();
    renderFriends();
  }));

  $$('[data-invite]').forEach((b) => b.addEventListener('click', async () => {
    const f = getFriends().find((x) => x.id === b.dataset.invite);
    if (!f) return;
    if (!net.isConnected(net.playerToPeerId(f.id))) {
      toast(`${f.name} is offline right now`, { icon: 'wifi-off', error: true });
      return;
    }
    try {
      if (!session.room) {
        const code = net.makeRoomCode();
        await net.hostRoom(code, roomHandlers());
        session.room = { code, role: 'host' };
      }
      net.send(net.playerToPeerId(f.id), { t: 'invite', code: session.room.code, profile: publicProfile() });
      toast(`Invite sent to ${f.name}`, { icon: 'swords' });
      go('room');
    } catch (err) {
      toast(err.message || 'Could not send invite', { icon: 'wifi-off', error: true });
    }
  }));

  $$('[data-dm]').forEach((b) => b.addEventListener('click', () => openDM(b.dataset.dm)));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    const f = getFriends().find((x) => x.id === b.dataset.remove);
    confirmModal(`Remove ${f?.name}?`, 'They will be removed from your friends list.', 'Remove', () => {
      removeFriend(b.dataset.remove);
      renderFriends();
      toast('Friend removed', { icon: 'check' });
    });
  }));
}

async function addFriendFlow(rawId) {
  const clean = String(rawId).trim().toUpperCase();
  if (!/^RVSI-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) {
    toast('That does not look like a Player ID (RVSI-XXXX-XXXX)', { icon: 'x', error: true });
    return;
  }
  if (clean === getProfile().id) {
    toast("That's your own ID!", { icon: 'x', error: true });
    return;
  }
  if (isFriend(clean)) {
    toast('Already on your friends list', { icon: 'users' });
    return;
  }
  toast('Sending request…', { icon: 'send' });
  try {
    await net.ensurePresence(getProfile().id, presenceHandlers());
    const pid = net.playerToPeerId(clean);
    const conn = await net.connect(pid, presenceHandlers(), 8000);
    conn.send({ t: 'hello', profile: publicProfile() });
    conn.send({ t: 'friend-req', profile: publicProfile() });
    sfx.message();
    toast(`Request sent — ${clean} can accept once they see it`, { icon: 'check', ms: 4500 });
  } catch (err) {
    toast(err.message || 'Could not reach that player', { icon: 'wifi-off', error: true });
  }
}

function openDM(friendId) {
  const f = getFriends().find((x) => x.id === friendId);
  if (!f) return;
  session.activeDM = friendId;
  session.dms[friendId] = session.dms[friendId] || [];
  openModal(`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span class="avatar ${f.avatar}">${esc(f.name.charAt(0).toUpperCase())}</span>
      <div><b>${esc(f.name)}</b><div class="conn-status ${friendStatus(f) === 'online' ? 'online' : ''}">${friendStatus(f) === 'online' ? 'Online' : 'Offline'}</div></div>
      <button class="icon-btn" style="margin-left:auto" data-close-modal aria-label="Close">${icon('x')}</button>
    </div>
    <div class="chat-log" id="dm-log" style="height:300px;border:1px solid var(--line);border-radius:12px"></div>
    <div class="chat-input-row" style="padding:10px 0 0">
      <input id="dm-input" maxlength="140" placeholder="Message ${esc(f.name)}…" aria-label="Direct message">
      <button class="icon-btn" data-dm-send aria-label="Send">${icon('send')}</button>
    </div>`, { label: `Chat with ${f.name}` });
  renderDMLog();
  $('[data-close-modal]').addEventListener('click', () => { session.activeDM = null; closeModal(); });
  const send = () => {
    const input = $('#dm-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    session.dms[friendId].push({ me: true, text, at: Date.now() });
    saveDMs(session.dms);
    renderDMLog();
    if (net.isConnected(net.playerToPeerId(friendId))) {
      net.send(net.playerToPeerId(friendId), { t: 'chat', text, profile: publicProfile() });
    } else {
      toast(`${f.name} is offline — messages stay on your device`, { icon: 'wifi-off', ms: 4000 });
    }
  };
  $('[data-dm-send]').addEventListener('click', send);
  $('#dm-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}

function renderDMLog() {
  const log = $('#dm-log');
  if (!log || !session.activeDM) return;
  const msgs = session.dms[session.activeDM] || [];
  log.innerHTML = msgs.length === 0
    ? `<div class="chat-sys">Say hi — messages arrive instantly while they're online</div>`
    : msgs.map((mm) => mm.sys
      ? `<div class="chat-sys">${esc(mm.text)}</div>`
      : `<div class="chat-msg${mm.me ? ' me' : ''}${mm.emote ? ' emote' : ''}"><div class="bubble">${esc(mm.text)}</div></div>`).join('');
  log.scrollTop = log.scrollHeight;
}

/* ---------- missions screen ---------- */

function renderMissions() {
  const missions = getMissions();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const hrs = Math.max(1, Math.floor((midnight - Date.now()) / 3600000));
  $('#screen-missions').innerHTML = `
    <div class="hero" style="padding:20px">
      <h1 style="font-size:26px">DAILY <em>MISSIONS</em></h1>
      <p>Fresh challenges every day. Complete them to earn bonus XP — resets in ${hrs}h.</p>
    </div>
    ${missions.map(missionRow).join('')}`;
  $$('[data-claim]').forEach((b) => b.addEventListener('click', () => {
    const res = claimMission(b.dataset.claim);
    if (res) {
      sfx.mission();
      toast(`Mission complete — +${res.xp} XP`, { icon: 'target' });
      renderTopbar();
      renderMissions();
    }
  }));
}

/* ---------- career screen ---------- */

function renderCareer() {
  const c = getCareer();
  const lvl = levelInfo(c.xp);
  const rank = rankOf(c.rating);
  const winRate = c.games ? Math.round((c.wins / c.games) * 100) : 0;
  const modes = [
    { key: 'local', label: 'Local', icon: 'swords' },
    { key: 'ai', label: 'VS AI', icon: 'cpu' },
    { key: 'online', label: 'Online', icon: 'globe' },
  ];
  $('#screen-career').innerHTML = `
    <div class="career-head">
      <div class="rank-badge">
        <span class="medal">${icon('medal')}</span>
        <div><b>${rank.name.toUpperCase()}</b><div class="sub">${c.rating} RP ${rank.next ? `· ${rank.next.min - c.rating} to ${rank.next.name}` : '· top tier'}</div></div>
      </div>
      <div class="card" style="flex:1;min-width:240px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <b style="font-family:var(--font-display);font-size:19px">LEVEL ${lvl.level}</b>
          <span style="font-size:12.5px;color:var(--text-3)">${lvl.into} / ${lvl.step} XP</span>
        </div>
        <div class="progress gold"><i style="width:${lvl.pct}%"></i></div>
      </div>
    </div>

    <h2 class="section-title">${icon('trophy')} Career stats</h2>
    <div class="stat-grid">
      <div class="stat-tile">${icon('swords')}<b>${c.games}</b><span>Matches played</span></div>
      <div class="stat-tile">${icon('check')}<b>${winRate}%</b><span>Win rate</span></div>
      <div class="stat-tile">${icon('flame')}<b>${c.bestStreak}</b><span>Best streak</span></div>
      <div class="stat-tile">${icon('crown')}<b>${c.peakRating}</b><span>Peak rating</span></div>
      <div class="stat-tile">${icon('target')}<b>${c.discsFlipped}</b><span>Discs flipped</span></div>
      <div class="stat-tile">${icon('shield')}<b>${c.cornersTaken}</b><span>Corners taken</span></div>
      <div class="stat-tile">${icon('zap')}<b>${c.wins}</b><span>Wins</span></div>
      <div class="stat-tile">${icon('cpu')}<b>${c.draws}</b><span>Draws</span></div>
    </div>

    <h2 class="section-title">${icon('grid')} Mode breakdown</h2>
    <div class="card">
      ${modes.map((mo) => {
        const b = c.byMode[mo.key];
        const wr = b.games ? Math.round((b.wins / b.games) * 100) : 0;
        return `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:6px">
            <span style="display:flex;gap:6px;align-items:center">${icon(mo.icon, 'icon icon-sm')} ${mo.label}</span>
            <span style="color:var(--text-3)">${b.wins}W / ${b.games} games · ${wr}%</span>
          </div>
          <div class="progress"><i style="width:${wr}%"></i></div>
        </div>`;
      }).join('')}
    </div>

    <h2 class="section-title">${icon('bell')} Match history</h2>
    ${c.history.length === 0
      ? `<div class="empty">${icon('trophy')}<p>No matches yet. Your career starts with the first disc you flip.</p></div>`
      : c.history.slice(0, 25).map((h) => `
        <div class="history-item">
          <span class="badge ${h.outcome}">${h.outcome.toUpperCase()}</span>
          <div class="who">
            <b>vs ${esc(h.opponent)}</b>
            <span>${h.mode === 'ai' ? `AI · ${DIFFICULTIES[h.difficulty]?.label || ''} · ` : ''}${h.mode === 'local' ? 'Local duel · ' : 'Online · '}${fmtDate(h.at)}</span>
          </div>
          <span class="score">${h.myScore}–${h.foeScore}</span>
          <span class="delta ${h.ratingDelta > 0 ? 'up' : h.ratingDelta < 0 ? 'down' : 'flat'}">${h.ratingDelta > 0 ? '+' : ''}${h.ratingDelta} RP</span>
        </div>`).join('')}`;
}

/* ---------- profile & settings ---------- */

function renderProfile() {
  const p = getProfile();
  const s = getSettings();
  const c = getCareer();
  const lvl = levelInfo(c.xp);
  const rank = rankOf(c.rating);
  $('#screen-profile').innerHTML = `
    <div class="card" style="text-align:center;padding:26px">
      <span class="avatar xl ${p.avatar}" style="margin:0 auto 12px">${esc(p.name.charAt(0).toUpperCase())}</span>
      <h2 style="font-size:28px;letter-spacing:.06em">${esc(p.name)}</h2>
      <p style="color:var(--text-3);font-size:13.5px">${p.id}</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        <span class="badge mode">LV ${lvl.level}</span>
        <span class="badge win">${rank.name}</span>
        <span class="badge">${c.rating} RP</span>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-edit-profile>${icon('edit')} Edit profile</button>
        <button class="btn btn-ghost btn-sm" data-copy-id2>${icon('copy')} Copy ID</button>
      </div>
    </div>

    <h2 class="section-title">${icon('settings')} Settings</h2>
    <div class="card">
      <div class="settings-row">
        <div class="s-body"><b>Sound effects</b><span>Disc flips, wins and notifications</span></div>
        <button class="switch" role="switch" aria-checked="${s.sound}" data-setting="sound" aria-label="Sound effects"></button>
      </div>
      <div class="settings-row">
        <div class="s-body"><b>Move hints</b><span>Show legal moves on the board</span></div>
        <button class="switch" role="switch" aria-checked="${s.hints}" data-setting="hints" aria-label="Move hints"></button>
      </div>
      <div class="settings-row">
        <div class="s-body"><b>Animations</b><span>Disc flip and pop effects</span></div>
        <button class="switch" role="switch" aria-checked="${s.animations}" data-setting="animations" aria-label="Animations"></button>
      </div>
      <div class="settings-row">
        <div class="s-body"><b>Board theme</b><span>Pick your felt</span></div>
        <div class="theme-dots">
          <button class="t-emerald ${s.boardTheme === 'emerald' ? 'selected' : ''}" data-theme="emerald" aria-label="Emerald board"></button>
          <button class="t-midnight ${s.boardTheme === 'midnight' ? 'selected' : ''}" data-theme="midnight" aria-label="Midnight board"></button>
          <button class="t-walnut ${s.boardTheme === 'walnut' ? 'selected' : ''}" data-theme="walnut" aria-label="Walnut board"></button>
        </div>
      </div>
    </div>

    <h2 class="section-title">${icon('flag')} Danger zone</h2>
    <div class="card">
      <div class="settings-row">
        <div class="s-body"><b>Reset career</b><span>Deletes stats, history and rating. Friends stay.</span></div>
        <button class="btn btn-danger btn-sm" data-reset-career>Reset</button>
      </div>
      <div class="settings-row">
        <div class="s-body"><b>Sign out</b><span>Removes the local profile from this device.</span></div>
        <button class="btn btn-danger btn-sm" data-signout>${icon('logout')} Sign out</button>
      </div>
    </div>`;

  $('[data-copy-id2]').addEventListener('click', () => copyText(p.id, 'Player ID copied'));
  $('[data-edit-profile]').addEventListener('click', openEditProfile);

  $$('[data-setting]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.setting;
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    updateSettings({ [key]: next });
    if (key === 'sound') setSound(next);
    if (key === 'animations') document.body.classList.toggle('no-anim', !next);
    sfx.tap();
  }));

  $$('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    updateSettings({ boardTheme: b.dataset.theme });
    $$('.theme-dots button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    const board = $('#board');
    if (board) board.className = `board theme-${b.dataset.theme}`;
    sfx.tap();
  }));

  $('[data-reset-career]').addEventListener('click', () => {
    confirmModal('Reset your career?', 'All stats, match history and rating will be wiped. This cannot be undone.', 'Reset everything', () => {
      const st = JSON.parse(localStorage.getItem('reversi.state.v1'));
      st.career = {
        rating: 1000, peakRating: 1000, xp: 0, games: 0, wins: 0, losses: 0, draws: 0,
        streak: 0, bestStreak: 0, discsFlipped: 0, cornersTaken: 0,
        byMode: { local: { games: 0, wins: 0 }, ai: { games: 0, wins: 0 }, online: { games: 0, wins: 0 } },
        history: [],
      };
      localStorage.setItem('reversi.state.v1', JSON.stringify(st));
      toast('Career reset', { icon: 'refresh' });
      renderProfile();
      renderTopbar();
    });
  });

  $('[data-signout]').addEventListener('click', () => {
    confirmModal('Sign out?', 'Your local profile will be removed from this device.', 'Sign out', () => {
      net.teardown();
      localStorage.removeItem('reversi.state.v1');
      localStorage.removeItem(DM_KEY);
      location.hash = '';
      location.reload();
    });
  });
}

function openEditProfile() {
  const p = getProfile();
  openModal(`
    <h2>Edit profile</h2>
    <p class="sub">Your Player ID never changes.</p>
    <div class="field" id="ef-name">
      <label for="ep-name">Call sign</label>
      <input id="ep-name" maxlength="16" value="${esc(p.name)}" data-autofocus>
      <span class="error">At least 2 characters.</span>
    </div>
    <div class="field" style="margin-top:14px">
      <label>Avatar</label>
      <div class="avatar-picker" role="radiogroup" aria-label="Avatar">
        ${avatarList().map((a) => `
          <button type="button" role="radio" aria-checked="${a === p.avatar}" data-avatar="${a}" class="${a === p.avatar ? 'selected' : ''}">
            <span class="avatar ${a}">${esc(p.name.charAt(0).toUpperCase())}</span>
          </button>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>
    </div>`, { label: 'Edit profile' });
  let chosen = p.avatar;
  $$('.avatar-picker button').forEach((b) => b.addEventListener('click', () => {
    $$('.avatar-picker button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    chosen = b.dataset.avatar;
    sfx.tap();
  }));
  $('[data-cancel]').addEventListener('click', closeModal);
  $('[data-save]').addEventListener('click', () => {
    const name = $('#ep-name').value.trim();
    if (name.length < 2) { $('#ef-name').classList.add('invalid'); return; }
    updateProfile({ name, avatar: chosen });
    closeModal();
    renderTopbar();
    renderProfile();
    toast('Profile updated', { icon: 'check' });
  });
}

/* ---------- settings modal (topbar) ---------- */

function openSettingsModal() {
  const s = getSettings();
  openModal(`
    <h2>Quick settings</h2>
    <p class="sub">Find the full set in your profile.</p>
    <div class="settings-row">
      <div class="s-body"><b>Sound effects</b></div>
      <button class="switch" role="switch" aria-checked="${s.sound}" data-qset="sound" aria-label="Sound"></button>
    </div>
    <div class="settings-row">
      <div class="s-body"><b>Move hints</b></div>
      <button class="switch" role="switch" aria-checked="${s.hints}" data-qset="hints" aria-label="Hints"></button>
    </div>
    <div class="settings-row">
      <div class="s-body"><b>Board theme</b></div>
      <div class="theme-dots">
        <button class="t-emerald ${s.boardTheme === 'emerald' ? 'selected' : ''}" data-qtheme="emerald" aria-label="Emerald"></button>
        <button class="t-midnight ${s.boardTheme === 'midnight' ? 'selected' : ''}" data-qtheme="midnight" aria-label="Midnight"></button>
        <button class="t-walnut ${s.boardTheme === 'walnut' ? 'selected' : ''}" data-qtheme="walnut" aria-label="Walnut"></button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" data-done>Done</button></div>`,
    { label: 'Settings' });
  $('[data-done]').addEventListener('click', closeModal);
  $$('[data-qset]').forEach((b) => b.addEventListener('click', () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    updateSettings({ [b.dataset.qset]: next });
    if (b.dataset.qset === 'sound') { setSound(next); renderTopbar(); }
    if (b.dataset.qset === 'hints' && session.match) renderGame();
    sfx.tap();
  }));
  $$('[data-qtheme]').forEach((b) => b.addEventListener('click', () => {
    updateSettings({ boardTheme: b.dataset.qtheme });
    $$('[data-qtheme]').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    const board = $('#board');
    if (board) board.className = `board theme-${b.dataset.qtheme}`;
    sfx.tap();
  }));
}

/* ---------- boot ---------- */

async function boot() {
  const p = getProfile();
  if (!p) {
    showScreen('onboard');
    renderOnboard();
    return;
  }
  renderTopbar();
  renderNav();
  route();

  setSound(getSettings().sound);
  document.body.classList.toggle('no-anim', !getSettings().animations);

  try {
    await net.ensurePresence(p.id, presenceHandlers());
    renderTopbar();
  } catch {
    toast('Offline mode — online play needs a connection', { icon: 'wifi-off', ms: 4500 });
  }

  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    history.replaceState(null, '', location.pathname);
    joinRoomFlow(roomParam);
  }
}

subscribe(() => renderNav());

$('#bottomnav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (b) go(b.dataset.nav);
});
$('#chip-profile').addEventListener('click', () => go('profile'));
$('#btn-settings').addEventListener('click', openSettingsModal);
$('#btn-sound').addEventListener('click', () => {
  const next = !getSettings().sound;
  updateSettings({ sound: next });
  setSound(next);
  renderTopbar();
  if (next) sfx.tap();
});
$('#presence-dot').addEventListener('click', async () => {
  if (net.isPresenceOnline()) { toast('You are online', { icon: 'check' }); return; }
  toast('Reconnecting…', { icon: 'refresh' });
  try {
    await net.ensurePresence(getProfile().id, presenceHandlers());
    renderTopbar();
    toast('Back online!', { icon: 'check' });
  } catch {
    toast('Still offline', { icon: 'wifi-off', error: true });
  }
});

boot();
