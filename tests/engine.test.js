import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, legalMoves, applyMove, flipsFor, playMove, isGameOver,
  resultOf, score, opponent, BLACK, WHITE, EMPTY, moveToNotation, idx,
} from '../js/engine.js';
import { chooseMove, DIFFICULTIES } from '../js/ai.js';

test('initial board setup and opening moves', () => {
  const b = initialBoard();
  assert.equal(b[idx(3, 3)], WHITE);
  assert.equal(b[idx(4, 4)], WHITE);
  assert.equal(b[idx(3, 4)], BLACK);
  assert.equal(b[idx(4, 3)], BLACK);
  assert.deepEqual(legalMoves(b, BLACK).sort((a, z) => a - z), [19, 26, 37, 44]);
  assert.deepEqual(legalMoves(b, WHITE).sort((a, z) => a - z), [20, 29, 34, 43]);
});

test('flips are correct for d3 opening', () => {
  const b = initialBoard();
  const flips = flipsFor(b, idx(2, 3), BLACK);
  assert.deepEqual(flips, [idx(3, 3)]);
  const next = applyMove(b, idx(2, 3), BLACK).board;
  assert.equal(next[idx(2, 3)], BLACK);
  assert.equal(next[idx(3, 3)], BLACK);
  assert.equal(next[idx(3, 4)], BLACK);
  assert.equal(next[idx(4, 4)], WHITE);
});

test('illegal move returns null / empty flips', () => {
  const b = initialBoard();
  assert.deepEqual(flipsFor(b, idx(0, 0), BLACK), []);
  assert.equal(applyMove(b, idx(0, 0), BLACK), null);
});

test('pass and game over resolution', () => {
  const b = new Int8Array(64);
  b[idx(0, 0)] = BLACK;
  b[idx(0, 1)] = WHITE;
  b[idx(7, 6)] = WHITE;
  b[idx(7, 7)] = BLACK;
  const res = playMove(b, idx(0, 2), BLACK);
  assert.ok(res);
  assert.equal(res.board[idx(0, 1)], BLACK);
  assert.equal(res.turn, BLACK, 'white must pass, black moves again');
  assert.equal(res.passed, true);
  const b2 = new Int8Array(64);
  b2[idx(0, 0)] = BLACK;
  b2[idx(0, 1)] = BLACK;
  assert.equal(playMove(b2, idx(0, 0), WHITE), null);
});

test('full game vs AI completes legally', () => {
  for (const diff of Object.keys(DIFFICULTIES)) {
    let board = initialBoard();
    let turn = BLACK;
    let guard = 0;
    while (!isGameOver(board) && guard++ < 120) {
      const moves = legalMoves(board, turn);
      if (moves.length === 0) {
        turn = opponent(turn);
        continue;
      }
      const mover = turn === WHITE ? chooseMove(board, WHITE, diff) : moves[0];
      assert.ok(moves.includes(mover), `${diff} AI played illegal move`);
      const played = playMove(board, mover, turn);
      board = played.board;
      turn = played.turn;
    }
    assert.ok(isGameOver(board), `${diff} game should finish`);
    const s = score(board);
    assert.ok(s.black + s.white >= 4 && s.black + s.white <= 64);
  }
});

test('AI prefers the corner when it is the strongest move', () => {
  const b = new Int8Array(64);
  b[idx(1, 4)] = WHITE;
  b[idx(2, 4)] = WHITE;
  b[idx(3, 4)] = BLACK;
  b[idx(3, 3)] = WHITE;
  b[idx(4, 3)] = BLACK;
  b[idx(4, 4)] = WHITE;
  const m = chooseMove(b, BLACK, 'hard');
  assert.equal(m, idx(0, 4));
});

test('notation and helpers', () => {
  assert.equal(moveToNotation(19), 'd3');
  assert.equal(moveToNotation(44), 'e6');
  assert.equal(moveToNotation(0), 'a1');
  assert.equal(opponent(WHITE), BLACK);
  assert.equal(opponent(BLACK), WHITE);
  const b = initialBoard();
  const r = resultOf(b);
  assert.equal(r.black, 2);
  assert.equal(r.white, 2);
  assert.equal(r.winner, EMPTY);
});
