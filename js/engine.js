/* Reversi engine — pure rules logic, no DOM. */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const SIZE = 8;

export const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export const CORNERS = [0, 7, 56, 63];

export function idx(r, c) {
  return r * SIZE + c;
}

export function rc(i) {
  return [Math.floor(i / SIZE), i % SIZE];
}

export function opponent(player) {
  return player === BLACK ? WHITE : BLACK;
}

export function initialBoard() {
  const b = new Int8Array(SIZE * SIZE);
  b[idx(3, 3)] = WHITE;
  b[idx(4, 4)] = WHITE;
  b[idx(3, 4)] = BLACK;
  b[idx(4, 3)] = BLACK;
  return b;
}

/* Returns array of flipped square indices if `player` plays `i`, empty if illegal. */
export function flipsFor(board, i, player) {
  if (board[i] !== EMPTY) return [];
  const foe = opponent(player);
  const [r0, c0] = rc(i);
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[idx(r, c)] === foe) {
      line.push(idx(r, c));
      r += dr;
      c += dc;
    }
    if (line.length > 0 && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[idx(r, c)] === player) {
      out.push(...line);
    }
  }
  return out;
}

export function isLegal(board, i, player) {
  return flipsFor(board, i, player).length > 0;
}

export function legalMoves(board, player) {
  const moves = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === EMPTY && flipsFor(board, i, player).length > 0) moves.push(i);
  }
  return moves;
}

export function applyMove(board, i, player) {
  const flips = flipsFor(board, i, player);
  if (flips.length === 0) return null;
  const next = board.slice();
  next[i] = player;
  for (const f of flips) next[f] = player;
  return { board: next, flips };
}

export function score(board) {
  let black = 0;
  let white = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) black++;
    else if (board[i] === WHITE) white++;
  }
  return { black, white };
}

export function hasAnyMove(board, player) {
  return legalMoves(board, player).length > 0;
}

/* Full turn resolution: returns { board, turn, passed, over } after playing `i`. */
export function playMove(board, i, player) {
  const res = applyMove(board, i, player);
  if (!res) return null;
  const foe = opponent(player);
  if (hasAnyMove(res.board, foe)) {
    return { board: res.board, turn: foe, passed: false, flips: res.flips };
  }
  if (hasAnyMove(res.board, player)) {
    return { board: res.board, turn: player, passed: true, flips: res.flips };
  }
  return { board: res.board, turn: EMPTY, passed: false, flips: res.flips, over: true };
}

export function isGameOver(board) {
  return !hasAnyMove(board, BLACK) && !hasAnyMove(board, WHITE);
}

export function resultOf(board) {
  const { black, white } = score(board);
  if (black > white) return { winner: BLACK, black, white, margin: black - white };
  if (white > black) return { winner: WHITE, black, white, margin: white - black };
  return { winner: EMPTY, black, white, margin: 0 };
}

export function moveToNotation(i) {
  if (i == null || i < 0) return '--';
  const [r, c] = rc(i);
  return String.fromCharCode(97 + c) + (r + 1);
}
