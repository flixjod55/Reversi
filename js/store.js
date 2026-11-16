/* Persistence layer — profile, career stats, rating, friends, missions,
 * settings. All state lives in localStorage under the "reversi." prefix. */

const KEY = 'reversi.state.v1';
const AVATARS = ['disc-dark', 'disc-light', 'fox', 'wolf', 'owl', 'tiger', 'shark', 'eagle'];

export const RANKS = [
  { name: 'Bronze',    min: 0,    icon: 'rank-bronze' },
  { name: 'Silver',    min: 1100, icon: 'rank-silver' },
  { name: 'Gold',      min: 1250, icon: 'rank-gold' },
  { name: 'Platinum',  min: 1400, icon: 'rank-platinum' },
  { name: 'Diamond',   min: 1550, icon: 'rank-diamond' },
  { name: 'Legend',    min: 1700, icon: 'rank-legend' },
];

export const MISSION_POOL = [
  { id: 'win-1',      text: 'Win {n} match',            n: 1, target: 1, xp: 120 },
  { id: 'play-3',     text: 'Play {n} matches',         n: 3, target: 3, xp: 100 },
  { id: 'flip-30',    text: 'Flip {n} discs',           n: 30, target: 30, xp: 90 },
  { id: 'win-ai-med', text: 'Beat Challenger AI once',  target: 1, xp: 130, tag: 'ai-medium' },
  { id: 'win-ai-hard',text: 'Beat Master AI once',      target: 1, xp: 200, tag: 'ai-hard' },
  { id: 'play-friend',text: 'Play a match with a friend', target: 1, xp: 150, tag: 'friend' },
  { id: 'win-2',      text: 'Win {n} matches',          n: 2, target: 2, xp: 160 },
  { id: 'corner',     text: 'Capture {n} corners',      n: 2, target: 2, xp: 110, tag: 'corners' },
];

export const LEVEL_STEP = 400;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function randomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `RVSI-${pick(4)}-${pick(4)}`;
}

function defaultState() {
  return {
    profile: null,
    settings: {
      sound: true,
      hints: true,
      animations: true,
      boardTheme: 'emerald',
      lastDifficulty: 'medium',
    },
    career: {
      rating: 1000,
      peakRating: 1000,
      xp: 0,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      discsFlipped: 0,
      cornersTaken: 0,
      byMode: {
        local: { games: 0, wins: 0 },
        ai: { games: 0, wins: 0 },
        online: { games: 0, wins: 0 },
      },
      history: [],
    },
    friends: [],
    requests: [],
    missions: { date: null, list: [] },
  };
}

let state = null;
const listeners = new Set();

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch {
    state = defaultState();
  }
  return state;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or unavailable — keep running in memory */
  }
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------- profile ---------- */

export function getProfile() {
  return load().profile;
}

export function createProfile(name, avatar) {
  const s = load();
  s.profile = {
    id: randomId(),
    name: (name || 'Player').slice(0, 16),
    avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
    createdAt: Date.now(),
  };
  save();
  return s.profile;
}

export function updateProfile(patch) {
  const s = load();
  if (!s.profile) return null;
  if (patch.name) s.profile.name = patch.name.slice(0, 16);
  if (patch.avatar && AVATARS.includes(patch.avatar)) s.profile.avatar = patch.avatar;
  save();
  return s.profile;
}

export function peerIdFor(profileId) {
  return profileId.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getSettings() {
  return load().settings;
}

export function updateSettings(patch) {
  const s = load();
  Object.assign(s.settings, patch);
  save();
  return s.settings;
}

/* ---------- career ---------- */

export function getCareer() {
  return load().career;
}

export function levelInfo(xp) {
  const level = Math.floor(xp / LEVEL_STEP) + 1;
  const into = xp % LEVEL_STEP;
  return { level, into, step: LEVEL_STEP, pct: Math.round((into / LEVEL_STEP) * 100) };
}

export function rankOf(rating) {
  let current = RANKS[0];
  for (const r of RANKS) if (rating >= r.min) current = r;
  const next = RANKS[RANKS.indexOf(current) + 1] || null;
  const pct = next
    ? Math.min(100, Math.round(((rating - current.min) / (next.min - current.min)) * 100))
    : 100;
  return { ...current, next, pct };
}

function ensureMissions() {
  const s = load();
  const today = todayKey();
  if (s.missions.date !== today) {
    const pool = MISSION_POOL.slice();
    const picked = [];
    while (picked.length < 3 && pool.length > 0) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    s.missions = {
      date: today,
      list: picked.map((m) => ({ ...m, progress: 0, claimed: false })),
    };
    save();
  }
  return s.missions;
}

export function getMissions() {
  return ensureMissions().list;
}

function bumpMission(id, amount = 1) {
  const s = load();
  ensureMissions();
  let changed = false;
  for (const m of s.missions.list) {
    if (m.id === id && !m.claimed && m.progress < m.target) {
      m.progress = Math.min(m.target, m.progress + amount);
      changed = true;
    }
  }
  if (changed) save();
}

/* Record a finished match and return the XP/rating delta summary. */
export function recordMatch({ mode, difficulty, opponentName, myScore, foeScore, flipped, corners }) {
  const s = load();
  const c = s.career;
  const iWon = myScore > foeScore;
  const draw = myScore === foeScore;
  const outcome = draw ? 'draw' : iWon ? 'win' : 'loss';

  const ratingDelta = computeRatingDelta(c.rating, iWon, draw, mode, difficulty);
  c.rating = Math.max(100, c.rating + ratingDelta);
  c.peakRating = Math.max(c.peakRating, c.rating);

  const base = iWon ? 100 : draw ? 55 : 25;
  const marginBonus = Math.min(50, Math.abs(myScore - foeScore) * 2);
  const xpGain = base + marginBonus + (mode === 'online' ? 20 : 0);
  c.xp += xpGain;
  c.games += 1;
  if (draw) c.draws += 1;
  else if (iWon) c.wins += 1;
  else c.losses += 1;
  c.streak = iWon ? c.streak + 1 : 0;
  c.bestStreak = Math.max(c.bestStreak, c.streak);
  c.discsFlipped += flipped || 0;
  c.cornersTaken += corners || 0;
  const bucket = c.byMode[mode] || { games: 0, wins: 0 };
  bucket.games += 1;
  if (iWon) bucket.wins += 1;
  c.byMode[mode] = bucket;

  c.history.unshift({
    mode,
    difficulty: difficulty || null,
    opponent: opponentName || (mode === 'ai' ? 'AI' : 'Player'),
    myScore,
    foeScore,
    outcome,
    ratingDelta,
    xpGain,
    at: Date.now(),
  });
  if (c.history.length > 60) c.history.length = 60;

  bumpMission('play-3');
  if (iWon) bumpMission('win-1');
  if (iWon) bumpMission('win-2');
  bumpMission('flip-30', flipped || 0);
  if (corners) bumpMission('corner', corners);
  if (iWon && mode === 'ai' && (difficulty === 'medium' || difficulty === 'hard' || difficulty === 'expert')) {
    bumpMission('win-ai-med');
    if (difficulty !== 'medium') bumpMission('win-ai-hard');
  }
  if (mode === 'online') bumpMission('play-friend');
  save();

  return { outcome, xpGain, ratingDelta, level: levelInfo(c.xp), rating: c.rating };
}

function computeRatingDelta(rating, won, draw, mode, difficulty) {
  if (mode === 'local') return 0;
  let expected = 0.5;
  if (mode === 'ai') {
    const aiRating = { easy: 850, medium: 1050, hard: 1300, expert: 1550 }[difficulty] || 1000;
    expected = 1 / (1 + 10 ** ((aiRating - rating) / 400));
  }
  const k = mode === 'online' ? 32 : 20;
  const actual = draw ? 0.5 : won ? 1 : 0;
  return Math.round(k * (actual - expected));
}

export function claimMission(id) {
  const s = load();
  ensureMissions();
  const m = s.missions.list.find((m) => m.id === id);
  if (!m || m.claimed || m.progress < m.target) return null;
  m.claimed = true;
  s.career.xp += m.xp;
  save();
  return { xp: m.xp, level: levelInfo(s.career.xp) };
}

/* ---------- friends ---------- */

export function getFriends() {
  return load().friends;
}

export function getRequests() {
  return load().requests;
}

export function addFriendRequest(from) {
  const s = load();
  if (!s.profile) return false;
  if (from.id === s.profile.id) return false;
  if (s.friends.some((f) => f.id === from.id)) return false;
  if (s.requests.some((r) => r.id === from.id)) return false;
  s.requests.unshift({ id: from.id, name: from.name, avatar: from.avatar, at: Date.now() });
  if (s.requests.length > 30) s.requests.length = 30;
  save();
  return true;
}

export function acceptFriend(id) {
  const s = load();
  const i = s.requests.findIndex((r) => r.id === id);
  if (i === -1) return null;
  const [req] = s.requests.splice(i, 1);
  if (!s.friends.some((f) => f.id === id)) {
    s.friends.unshift({ id: req.id, name: req.name, avatar: req.avatar, addedAt: Date.now() });
  }
  save();
  return req;
}

export function declineFriend(id) {
  const s = load();
  s.requests = s.requests.filter((r) => r.id !== id);
  save();
}

export function addFriendDirect(entry) {
  const s = load();
  if (!s.friends.some((f) => f.id === entry.id)) {
    s.friends.unshift({ id: entry.id, name: entry.name, avatar: entry.avatar, addedAt: Date.now() });
    save();
    return true;
  }
  return false;
}

export function removeFriend(id) {
  const s = load();
  s.friends = s.friends.filter((f) => f.id !== id);
  save();
}

export function isFriend(id) {
  return load().friends.some((f) => f.id === id);
}

export function avatarList() {
  return AVATARS.slice();
}
