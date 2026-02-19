const express = require('express');
const router = express.Router();
const gameManager = require('../game/game-manager');
const db = require('../db');

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim().substring(0, 30);
  const cleaned = trimmed.replace(/[^a-zA-Z0-9 _\-]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

router.post('/games', (req, res) => {
  const playerName = sanitizeName(req.body.playerName);
  if (!playerName) {
    return res.status(400).json({ error: 'Valid player name required (letters, numbers, max 30 chars)' });
  }
  try {
    const result = gameManager.createGame(playerName);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create game' });
  }
});

router.post('/games/:gameId/join', (req, res) => {
  const { gameId } = req.params;
  const playerName = sanitizeName(req.body.playerName);
  if (!playerName) {
    return res.status(400).json({ error: 'Valid player name required (letters, numbers, max 30 chars)' });
  }
  try {
    const result = gameManager.joinGame(gameId, playerName);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to join game' });
  }
});

router.post('/games/:gameId/reconnect', (req, res) => {
  const { gameId } = req.params;
  const { playerId } = req.body;
  if (!playerId) return res.status(400).json({ error: 'Player ID required' });
  try {
    const result = gameManager.reconnectToGame(gameId, playerId);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to reconnect' });
  }
});

router.get('/games/:gameId', (req, res) => {
  const dbGame = db.getGame(req.params.gameId);
  if (!dbGame) return res.status(404).json({ error: 'Game not found' });
  const whitePlayer = dbGame.white_player_id ? db.getPlayer(dbGame.white_player_id) : null;
  const blackPlayer = dbGame.black_player_id ? db.getPlayer(dbGame.black_player_id) : null;
  res.json({
    id: dbGame.id,
    status: dbGame.status,
    result: dbGame.result,
    whiteName: whitePlayer?.display_name,
    blackName: blackPlayer?.display_name,
    createdAt: dbGame.created_at
  });
});

router.get('/games/:gameId/moves', (req, res) => {
  const moves = db.getGameMoves(req.params.gameId);
  res.json(moves);
});

router.get('/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(db.getLeaderboard(limit));
});

router.get('/recent-games', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json(db.getRecentGames(limit));
});

router.get('/stats', (req, res) => {
  res.json(db.getStats());
});

module.exports = router;
