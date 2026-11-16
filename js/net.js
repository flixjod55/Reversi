/* Online play over WebRTC via PeerJS. Your Player ID *is* your peer ID, so
 * friends connect straight to each other: invites, rooms, chat and presence
 * all work with zero backend. Two concurrent peers are supported: a personal
 * presence peer (friends, DMs, invites) and a room peer (match hosting). */

import { peerIdFor } from './store.js';

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'rvsi1-';

let personal = null;
let personalReady = null;
let roomPeer = null;
const conns = new Map();

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function roomToPeerId(code) {
  return PREFIX + 'room-' + normalizeCode(code).toLowerCase();
}

export function playerToPeerId(profileId) {
  return PREFIX + peerIdFor(profileId);
}

export function peerIdToPlayer(peerId) {
  if (!peerId || !peerId.startsWith(PREFIX)) return null;
  const rest = peerId.slice(PREFIX.length);
  if (rest.startsWith('room-')) return null;
  const raw = rest.toUpperCase();
  if (raw.length < 8) return null;
  return `RVSI-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-peerjs]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Peer));
      existing.addEventListener('error', () => reject(new Error('PeerJS failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.dataset.peerjs = '1';
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error('PeerJS failed to load — check your connection'));
    document.head.appendChild(s);
  });
}

function attach(conn, handlers) {
  conn.on('open', () => {
    conns.set(conn.peer, conn);
    handlers.onConnection?.(conn.peer);
  });
  conn.on('data', (msg) => handlers.onMessage?.(conn.peer, msg));
  conn.on('close', () => {
    conns.delete(conn.peer);
    handlers.onClose?.(conn.peer);
  });
  conn.on('error', () => {
    conns.delete(conn.peer);
    handlers.onClose?.(conn.peer);
  });
}

/* Personal presence peer — one per session, keyed to the Player ID. */
export function ensurePresence(myPlayerId, handlers = {}) {
  if (personalReady) return personalReady;
  personalReady = (async () => {
    const Peer = await loadPeerJS();
    personal = new Peer(playerToPeerId(myPlayerId), { debug: 0 });
    personal.on('connection', (conn) => attach(conn, handlers));
    personal.on('disconnected', () => {
      try { personal?.reconnect(); } catch { /* broker gone */ }
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Could not reach the matchmaking network')), 12000);
      personal.on('open', () => { clearTimeout(t); resolve(); });
      personal.on('error', (err) => { clearTimeout(t); reject(err); });
    });
    return personal;
  })();
  return personalReady;
}

export function isPresenceOnline() {
  return !!(personal && personal.open);
}

export function isRoomHost() {
  return !!(roomPeer && roomPeer.open);
}

export function connect(targetPeerId, handlers, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!personal) return reject(new Error('Not connected'));
    const existing = conns.get(targetPeerId);
    if (existing && existing.open) return resolve(existing);
    const conn = personal.connect(targetPeerId, { reliable: true });
    const timer = setTimeout(() => {
      try { conn.close(); } catch { /* noop */ }
      reject(new Error('That player is offline or unreachable'));
    }, timeoutMs);
    attach(conn, handlers);
    conn.on('open', () => {
      clearTimeout(timer);
      resolve(conn);
    });
    conn.on('error', (e) => {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error('Connection failed'));
    });
  });
}

export function send(peerId, msg) {
  const conn = conns.get(peerId);
  if (conn && conn.open) {
    conn.send(msg);
    return true;
  }
  return false;
}

export function isConnected(peerId) {
  const conn = conns.get(peerId);
  return !!(conn && conn.open);
}

export function drop(peerId) {
  const conn = conns.get(peerId);
  if (conn) {
    try { conn.close(); } catch { /* noop */ }
    conns.delete(peerId);
  }
}

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

/* Room peer — separate instance so presence stays alive while hosting. */
export async function hostRoom(code, handlers) {
  const Peer = await loadPeerJS();
  if (roomPeer) {
    try { roomPeer.destroy(); } catch { /* noop */ }
    roomPeer = null;
  }
  roomPeer = new Peer(roomToPeerId(code), { debug: 0 });
  roomPeer.on('connection', (conn) => attach(conn, handlers));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Could not open the room')), 12000);
    roomPeer.on('open', () => { clearTimeout(t); resolve(); });
    roomPeer.on('error', (err) => { clearTimeout(t); reject(err); });
  });
  return roomPeer;
}

export function closeRoom() {
  if (roomPeer) {
    try { roomPeer.destroy(); } catch { /* noop */ }
    roomPeer = null;
  }
}

export async function joinRoom(code, handlers) {
  await loadPeerJS();
  return connect(roomToPeerId(code), handlers, 12000);
}

export function teardown() {
  for (const [, conn] of conns) {
    try { conn.close(); } catch { /* noop */ }
  }
  conns.clear();
  closeRoom();
  if (personal) {
    try { personal.destroy(); } catch { /* noop */ }
  }
  personal = null;
  personalReady = null;
}
