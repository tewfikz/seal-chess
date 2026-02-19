# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (runs on port 3000, override with `PORT=8080 npm start`)
- **Dev mode (auto-restart):** `npm run dev` (uses Node.js `--watch`)
- **Run tests:** `npm test` (57 integration tests in `tests/run-tests.js` — starts its own server on a random port, no external setup needed)
- **Run migrations:** `npm run migrate` (also runs automatically on server start)
- **Install:** `npm install` (requires Node >= 18; `better-sqlite3` has a native build step)

No build step, linter, or formatter is configured.

## Architecture

Real-time multiplayer chess app: Node.js/Express server with Socket.IO, SQLite persistence, and a vanilla JS frontend. No TypeScript, no bundler, all CommonJS modules.

### Request Flow

1. **Lobby (REST):** Client POSTs `/api/games` or `/api/games/:id/join` → gets `gameId`, `playerId`, `color` → stored in `localStorage` as `crab_chess_session`
2. **Game (WebSocket):** Client connects via Socket.IO, emits `join-game` → all gameplay (moves, resign, draw offers) happens over socket events
3. **Persistence:** Every state change written synchronously to SQLite via `better-sqlite3`

### Key Modules

- **`src/game/game-manager.js`** — Core game logic. `GameInstance` wraps a `chess.js` Chess instance per game. `gameManager` is a factory/registry over a `Map<gameId, GameInstance>`. Handles move validation, game-end detection, draw negotiation, resign, and 60-second disconnect abandonment timers. Can restore games from DB on reconnect (survives server restart).
- **`src/game/socket-handler.js`** — Maps Socket.IO events to `GameInstance` methods. Key events: `join-game`, `make-move`, `resign`, `offer-draw`, `accept-draw`, `decline-draw`. Broadcasts results to the socket room.
- **`src/db/index.js`** — Thin synchronous SQLite layer. Auto-runs migrations on `require()`. All prepared statements, WAL mode.
- **`src/routes/api.js`** — REST endpoints with input sanitization (alphanumeric + spaces/hyphens/underscores, max 30 chars) and rate limiting (60 req/min/IP).
- **`public/js/chess-board.js`** — `ChessBoard` class: renders 8x8 grid, handles piece selection/move via two-click flow, highlights legal moves (received from server).
- **`public/js/app.js`** — Client controller: manages socket connection, game state, UI updates, move sounds (Web Audio API), session persistence.

### Design Decisions

- **All chess validation is server-side only** — the client receives a pre-computed legal moves map from the server and enforces no rules independently.
- **Completed games are cleaned from memory** after 5 minutes but remain in SQLite permanently.
- **No authentication** — players identified by UUID in localStorage.
- **Database schema** (in `migrations/001_initial.sql`): three tables — `players`, `games`, `moves`. Scoring: Win=3, Draw=1, Loss=0.

### Known Issue

The rebrand from "Crab Chess" to "Seal Chess" is incomplete — `server.js`, `app.js`, `run-tests.js`, and `001_initial.sql` still contain "Crab Chess" references in comments/logs.
