# Reversi Prime

A premium, web-based Reversi (Othello) with the social feel of modern mobile esports titles — inspired by the account, friends and invite flows of games like VALORANT Mobile, BGMI and PUBG: New State.

## Features

**Game**
- Full Reversi rules: legal-move validation, forced passes, endgame scoring
- Animated 3D disc flips, last-move marker, move hints
- Three board themes (Emerald, Midnight, Walnut), synthesized sound effects
- Undo (local/AI modes), hint (alpha-beta best move), end-of-match confirm

**Modes**
- **Local Duel** — pass & play on one device
- **VS AI** — four difficulties (Rookie → Grandmaster) powered by alpha-beta minimax with positional weights, mobility, frontier and corner-stability heuristics, plus exact endgame solving in the last 11 empties
- **Online with friends** — peer-to-peer over WebRTC (PeerJS): create a room, share the 6-character code or invite link, or send a direct match invite from your friends list. Includes rematch flow, forfeit handling and disconnect recovery.

**Social**
- Player ID (`RVSI-XXXX-XXXX`) doubles as your peer identity — no backend, no sign-up server
- Friends list with online status, friend requests, remove
- Direct messages (P2P while both online) and in-match chat with quick emotes
- Match invites with accept/decline

**Career & progression** (stored locally on your device)
- Elo-style rating (RP) with rank tiers: Bronze → Silver → Gold → Platinum → Diamond → Legend
- XP, levels, win rate, best streak, discs flipped, corners taken
- Per-mode breakdown and 25-match history
- Daily missions (3 per day, rotating pool) with XP rewards

## Run it

Any static file server works:

```bash
npm test          # run engine + AI test suite
npm start         # serve on http://localhost:8080
```

Or deploy the folder as-is to GitHub Pages, Netlify, Vercel, Cloudflare Pages…

## Tech

- Zero build step: vanilla ES modules + modern CSS
- PeerJS (WebRTC) for signaling/transport — the only third-party runtime dependency, loaded from CDN
- WebAudio-synthesized SFX (no audio assets)
- Responsive: bottom navigation on mobile, centered layout on desktop; keyboard accessible; `prefers-reduced-motion` respected

## Notes

- Career stats, friends and DM history live in `localStorage` on your device — there is intentionally no account server.
- Online play requires both players to be online at the same time (peer-to-peer). If the PeerJS CDN or its public broker is unreachable, the app degrades gracefully to offline mode.
