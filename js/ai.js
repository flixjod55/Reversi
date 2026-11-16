/* Reversi AI — alpha-beta minimax with positional weights, mobility and
 * stability heuristics. Four difficulties. Pure module, no DOM. */

import {
  EMPTY, BLACK, WHITE, SIZE, CORNERS, legalMoves, applyMove, score,
  isGameOver, opponent, resultOf,
} from './engine.js';

/* Positional weight table: corners are gold, X/C squares next to free
 * corners are poison, edges are strong. */
const WEIGHTS = [
  120, -20, 20,  5,  5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
   20,  -5, 15,  3,  3, 15,  -5,  20,
    5,  -5,  3,  3,  3,  3,  -5,   5,
    5,  -5,  3,  3,  3,  3,  -5,   5,
   20,  -5, 15,  3,  3, 15,  -5,  20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20,  5,  5, 20, -20, 120,
];

export const DIFFICULTIES = {
  easy:   { label: 'Rookie',    depth: 1, noise: 0.55 },
  medium: { label: 'Challenger', depth: 2, noise: 0.18 },
  hard:   { label: 'Master',    depth: 4, noise: 0 },
  expert: { label: 'Grandmaster', depth: 6, noise: 0 },
};

const ENDGAME_EMPTIES = 11;

function stableCorners(board, player) {
  let mine = 0;
  let foe = 0;
  for (const c of CORNERS) {
    if (board[c] === player) mine++;
    else if (board[c] === opponent(player)) foe++;
  }
  return mine - foe;
}

function evaluate(board, player) {
  const foe = opponent(player);
  let pos = 0;
  let mine = 0;
  let their = 0;
  let myFrontier = 0;
  let foeFrontier = 0;
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (v === EMPTY) continue;
    pos += (v === player ? 1 : -1) * WEIGHTS[i];
    if (v === player) mine++;
    else their++;
    if (hasEmptyNeighbor(board, i)) {
      if (v === player) myFrontier++;
      else foeFrontier++;
    }
  }
  const discScore = 100 * (mine - their) / (mine + their || 1);
  const mobility = mobilityScore(board, player);
  const corners = 25 * stableCorners(board, player);
  const frontier = -12 * (myFrontier - foeFrontier);
  return Math.round(pos + 8 * discScore + mobility + corners + frontier);
}

function hasEmptyNeighbor(board, i) {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr * SIZE + nc] === EMPTY) return true;
    }
  }
  return false;
}

function mobilityScore(board, player) {
  const mine = legalMoves(board, player).length;
  const theirs = legalMoves(board, opponent(player)).length;
  return 10 * (mine - theirs) / (mine + theirs || 1);
}

function orderMoves(board, moves) {
  return moves.slice().sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
}

function negamax(board, player, depth, alpha, beta, deadline) {
  if (Date.now() > deadline) return evaluate(board, player);
  if (depth <= 0 || isGameOver(board)) return evaluate(board, player);

  const moves = legalMoves(board, player);
  if (moves.length === 0) {
    if (legalMoves(board, opponent(player)).length === 0) {
      const res = resultOf(board);
      if (res.winner === player) return 100000 + res.margin;
      if (res.winner === EMPTY) return 0;
      return -100000 - res.margin;
    }
    return -negamax(board, opponent(player), depth - 1, -beta, -alpha, deadline);
  }

  let best = -Infinity;
  for (const m of orderMoves(board, moves)) {
    const next = applyMove(board, m, player).board;
    const val = -negamax(next, opponent(player), depth - 1, -beta, -Math.max(alpha, best), deadline);
    if (val > best) best = val;
    if (best >= beta) break;
  }
  return best;
}

/* Public: pick a move for `player` on `board`. */
export function chooseMove(board, player, difficulty = 'medium') {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const moves = legalMoves(board, player);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const empties = board.reduce((n, v) => n + (v === EMPTY ? 1 : 0), 0);
  const depth = empties <= ENDGAME_EMPTIES && difficulty !== 'easy' && difficulty !== 'medium'
    ? Math.max(cfg.depth, empties)
    : cfg.depth;
  const deadline = Date.now() + (difficulty === 'expert' ? 2500 : 1200);

  let best = moves[0];
  let bestVal = -Infinity;
  const vals = [];
  for (const m of orderMoves(board, moves)) {
    const next = applyMove(board, m, player).board;
    const val = -negamax(next, opponent(player), depth - 1, -Infinity, Infinity, deadline);
    vals.push({ m, val: val + (cfg.noise ? (Math.random() * 2 - 1) * cfg.noise * 120 : 0) });
    if (val > bestVal) {
      bestVal = val;
      best = m;
    }
  }
  if (cfg.noise) {
    vals.sort((a, b) => b.val - a.val);
    best = vals[0].m;
  }
  return best;
}
