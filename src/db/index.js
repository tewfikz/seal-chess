const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'chess.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Auto-run migrations on startup
const migrationPath = path.join(__dirname, '..', '..', 'migrations', '001_initial.sql');
if (fs.existsSync(migrationPath)) {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  db.exec(migration);
}

module.exports = {
  createPlayer(id, displayName) {
    const stmt = db.prepare('INSERT INTO players (id, display_name) VALUES (?, ?)');
    return stmt.run(id, displayName);
  },

  getPlayer(id) {
    return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  },

  getLeaderboard(limit = 20) {
    return db.prepare(
      'SELECT id, display_name, wins, losses, draws, score FROM players ORDER BY score DESC, wins DESC LIMIT ?'
    ).all(limit);
  },

  updatePlayerStats(playerId, result) {
    const scoreMap = { win: 3, draw: 1, loss: 0 };
    const colMap = { win: 'wins', loss: 'losses', draw: 'draws' };
    const col = colMap[result];
    const points = scoreMap[result];
    const stmt = db.prepare(
      `UPDATE players SET ${col} = ${col} + 1, score = score + ? WHERE id = ?`
    );
    return stmt.run(points, playerId);
  },

  createGame(id, whitePlayerId) {
    const stmt = db.prepare('INSERT INTO games (id, white_player_id, status) VALUES (?, ?, ?)');
    return stmt.run(id, whitePlayerId, 'waiting');
  },

  getGame(id) {
    return db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  },

  joinGame(gameId, blackPlayerId) {
    const stmt = db.prepare(
      'UPDATE games SET black_player_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    return stmt.run(blackPlayerId, 'active', gameId);
  },

  updateGameState(gameId, fen, pgn) {
    const stmt = db.prepare(
      'UPDATE games SET fen = ?, pgn = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    return stmt.run(fen, pgn, gameId);
  },

  completeGame(gameId, result) {
    const stmt = db.prepare(
      'UPDATE games SET status = ?, result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    return stmt.run('completed', result, gameId);
  },

  abandonGame(gameId) {
    const stmt = db.prepare(
      'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    return stmt.run('abandoned', gameId);
  },

  getRecentGames(limit = 20) {
    return db.prepare(`
      SELECT g.*,
        wp.display_name as white_name,
        bp.display_name as black_name
      FROM games g
      LEFT JOIN players wp ON g.white_player_id = wp.id
      LEFT JOIN players bp ON g.black_player_id = bp.id
      WHERE g.status = 'completed'
      ORDER BY g.updated_at DESC
      LIMIT ?
    `).all(limit);
  },

  recordMove(gameId, moveNumber, playerId, from, to, san, fenAfter) {
    const stmt = db.prepare(
      'INSERT INTO moves (game_id, move_number, player_id, from_square, to_square, san, fen_after) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    return stmt.run(gameId, moveNumber, playerId, from, to, san, fenAfter);
  },

  getGameMoves(gameId) {
    return db.prepare(
      'SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC'
    ).all(gameId);
  },

  getStats() {
    const totalGames = db.prepare('SELECT COUNT(*) as count FROM games WHERE status = ?').get('completed');
    const totalPlayers = db.prepare('SELECT COUNT(*) as count FROM players').get();
    const activeGames = db.prepare('SELECT COUNT(*) as count FROM games WHERE status IN (?, ?)').get('waiting', 'active');
    return {
      totalGames: totalGames.count,
      totalPlayers: totalPlayers.count,
      activeGames: activeGames.count
    };
  },

  close() {
    db.close();
  }
};
