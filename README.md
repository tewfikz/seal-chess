# Crab Chess

Real-time multiplayer chess with crab-themed pieces. Create a game, share the invite link, and play against a friend with full chess rules and persistent scoring.

## Features

- **Real-time multiplayer** via Socket.IO WebSockets
- **Full chess rules**: check, checkmate, stalemate, castling, en passant, pawn promotion
- **Crab-themed SVG pieces** - 12 custom vector crab designs (king, queen, bishop, knight, rook, pawn)
- **Invite link system** - create a game, share the URL, opponent joins instantly
- **Persistent SQLite database** - all players, games, moves, and results stored permanently
- **Leaderboard** with scoring: Win = 3, Draw = 1, Loss = 0
- **Disconnect/reconnect handling** with 60-second timeout
- **Draw offers and resignation**
- **Mobile-responsive** design
- **Input sanitization** and rate limiting

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Real-time | Socket.IO |
| Chess logic | chess.js (server-side validation) |
| Database | SQLite via better-sqlite3 |
| Frontend | Vanilla HTML/CSS/JS |
| Assets | Custom SVG crab pieces |

## Quick Start

### Prerequisites

- Node.js >= 18.0.0

### Install & Run

```bash
git clone <repo-url>
cd crab-chess
npm install
npm start
```

Server starts at `http://localhost:3000`

### Development Mode (auto-restart)

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

Runs 57 automated integration tests covering: game creation, joining, Socket.IO multiplayer, move validation, persistence, scoring, leaderboard, reconnect, and input validation.

### Custom Port

```bash
PORT=8080 npm start
```

## How to Play

1. Open `http://localhost:3000`
2. Enter your display name and click **Create Game**
3. Copy the invite link and send it to your opponent
4. Opponent opens the link, enters their name, and clicks **Join Game**
5. White moves first - click a piece, then click a destination square
6. Green dots show legal moves, rings show captures
7. Use **Offer Draw** or **Resign** buttons during the game

## Project Structure

```
crab-chess/
├── src/
│   ├── server.js              # Express + Socket.IO entry point
│   ├── db/
│   │   └── index.js           # SQLite database access layer
│   ├── game/
│   │   ├── game-manager.js    # In-memory game state + chess.js
│   │   └── socket-handler.js  # Socket.IO event handlers
│   └── routes/
│       └── api.js             # REST API endpoints
├── public/
│   ├── index.html             # Main game page (lobby + board)
│   ├── leaderboard.html       # Leaderboard page
│   ├── css/
│   │   └── style.css          # All styles
│   ├── js/
│   │   ├── chess-board.js     # Board renderer + interaction
│   │   └── app.js             # Client app controller + Socket.IO
│   └── assets/
│       └── pieces/            # 12 crab SVG files
├── migrations/
│   ├── 001_initial.sql        # Schema definition
│   └── run.js                 # Migration runner
├── tests/
│   └── run-tests.js           # Integration test suite
├── data/                      # SQLite DB files (auto-created)
└── package.json
```

## Database Schema

### players
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| display_name | TEXT | Sanitized player name |
| wins | INTEGER | Win count |
| losses | INTEGER | Loss count |
| draws | INTEGER | Draw count |
| score | INTEGER | Total score (W*3 + D*1) |

### games
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Short UUID (8 chars) |
| white_player_id | TEXT FK | White player |
| black_player_id | TEXT FK | Black player |
| status | TEXT | waiting/active/completed/abandoned |
| result | TEXT | white_wins/black_wins/draw |
| fen | TEXT | Current board position |
| pgn | TEXT | Portable Game Notation |

### moves
| Column | Type | Description |
|--------|------|-------------|
| game_id | TEXT FK | Parent game |
| move_number | INTEGER | Sequential move number |
| san | TEXT | Standard Algebraic Notation |
| fen_after | TEXT | Position after move |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/games | Create new game |
| POST | /api/games/:id/join | Join existing game |
| POST | /api/games/:id/reconnect | Reconnect to game |
| GET | /api/games/:id | Get game info |
| GET | /api/games/:id/moves | Get move history |
| GET | /api/leaderboard | Get leaderboard |
| GET | /api/recent-games | Get recent completed games |
| GET | /api/stats | Get aggregate stats |

## Deployment

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |

### Production Notes

- SQLite database stored in `./data/chess.db` - mount as a volume for persistence
- WAL mode enabled for concurrent read performance
- Rate limiting: 60 requests/minute per IP on API routes
- WebSocket transport with polling fallback
- 60-second disconnect timeout before game is abandoned

## Scoring System

| Result | Points |
|--------|--------|
| Win | 3 |
| Draw | 1 |
| Loss | 0 |

Leaderboard ranks by total score, then by win count as tiebreaker.

## Test Evidence

### Integration Tests (57/57 passing)

- Game creation with input validation
- Game joining with duplicate/invalid prevention
- Real-time Socket.IO multiplayer (2-player move exchange)
- Server-side move validation (illegal moves rejected)
- Resignation flow
- Database persistence (games, moves, results survive restart)
- Scoring system (win=3, loss=0 verified)
- Leaderboard ordering
- Reconnection handling
- XSS sanitization
