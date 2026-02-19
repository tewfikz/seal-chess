const { Chess } = require('chess.js');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const activeGames = new Map();

class GameInstance {
  constructor(gameId, whitePlayerId) {
    this.gameId = gameId;
    this.chess = new Chess();
    this.whitePlayerId = whitePlayerId;
    this.blackPlayerId = null;
    this.whiteSocketId = null;
    this.blackSocketId = null;
    this.whiteConnected = false;
    this.blackConnected = false;
    this.moveCount = 0;
    this.status = 'waiting';
    this.drawOffer = null;
    this.disconnectTimers = {};
  }

  getPlayerColor(playerId) {
    if (playerId === this.whitePlayerId) return 'white';
    if (playerId === this.blackPlayerId) return 'black';
    return null;
  }

  isPlayerTurn(playerId) {
    const turn = this.chess.turn();
    if (turn === 'w' && playerId === this.whitePlayerId) return true;
    if (turn === 'b' && playerId === this.blackPlayerId) return true;
    return false;
  }

  makeMove(playerId, from, to, promotion) {
    if (!this.isPlayerTurn(playerId)) {
      return { success: false, error: 'Not your turn' };
    }
    if (this.status !== 'active') {
      return { success: false, error: 'Game is not active' };
    }

    try {
      const moveObj = { from, to };
      if (promotion) moveObj.promotion = promotion;

      const move = this.chess.move(moveObj);
      if (!move) {
        return { success: false, error: 'Illegal move' };
      }

      this.moveCount++;
      this.drawOffer = null;

      db.recordMove(this.gameId, this.moveCount, playerId, from, to, move.san, this.chess.fen());
      db.updateGameState(this.gameId, this.chess.fen(), this.chess.pgn());

      const gameResult = this.checkGameEnd();

      return {
        success: true,
        move,
        fen: this.chess.fen(),
        pgn: this.chess.pgn(),
        gameResult,
        inCheck: this.chess.inCheck(),
        moveNumber: this.moveCount
      };
    } catch (e) {
      return { success: false, error: 'Invalid move' };
    }
  }

  checkGameEnd() {
    if (this.chess.isCheckmate()) {
      const winner = this.chess.turn() === 'w' ? 'black' : 'white';
      const result = winner === 'white' ? 'white_wins' : 'black_wins';
      this.endGame(result);
      return { type: 'checkmate', winner, result };
    }
    if (this.chess.isStalemate()) {
      this.endGame('draw');
      return { type: 'stalemate', result: 'draw' };
    }
    if (this.chess.isDraw()) {
      this.endGame('draw');
      let reason = 'fifty-move rule';
      if (this.chess.isThreefoldRepetition()) reason = 'threefold repetition';
      if (this.chess.isInsufficientMaterial()) reason = 'insufficient material';
      return { type: 'draw', reason, result: 'draw' };
    }
    return null;
  }

  endGame(result) {
    this.status = 'completed';
    db.completeGame(this.gameId, result);

    if (result === 'white_wins') {
      db.updatePlayerStats(this.whitePlayerId, 'win');
      db.updatePlayerStats(this.blackPlayerId, 'loss');
    } else if (result === 'black_wins') {
      db.updatePlayerStats(this.blackPlayerId, 'win');
      db.updatePlayerStats(this.whitePlayerId, 'loss');
    } else if (result === 'draw') {
      db.updatePlayerStats(this.whitePlayerId, 'draw');
      db.updatePlayerStats(this.blackPlayerId, 'draw');
    }
  }

  resign(playerId) {
    if (this.status !== 'active') return null;
    const color = this.getPlayerColor(playerId);
    if (!color) return null;
    const result = color === 'white' ? 'black_wins' : 'white_wins';
    this.endGame(result);
    return { type: 'resignation', winner: color === 'white' ? 'black' : 'white', result };
  }

  offerDraw(playerId) {
    if (this.status !== 'active') return null;
    if (this.drawOffer === playerId) return null;
    this.drawOffer = playerId;
    return { offeredBy: this.getPlayerColor(playerId) };
  }

  acceptDraw(playerId) {
    if (!this.drawOffer || this.drawOffer === playerId) return null;
    this.endGame('draw');
    return { type: 'draw_agreed', result: 'draw' };
  }

  declineDraw(playerId) {
    if (!this.drawOffer || this.drawOffer === playerId) return null;
    this.drawOffer = null;
    return { declined: true };
  }

  getState() {
    return {
      gameId: this.gameId,
      fen: this.chess.fen(),
      pgn: this.chess.pgn(),
      turn: this.chess.turn() === 'w' ? 'white' : 'black',
      status: this.status,
      inCheck: this.chess.inCheck(),
      isGameOver: this.chess.isGameOver(),
      whitePlayerId: this.whitePlayerId,
      blackPlayerId: this.blackPlayerId,
      whiteConnected: this.whiteConnected,
      blackConnected: this.blackConnected,
      moveCount: this.moveCount,
      drawOffer: this.drawOffer,
      legalMoves: this.getLegalMoves()
    };
  }

  getLegalMoves() {
    const moves = this.chess.moves({ verbose: true });
    const grouped = {};
    for (const m of moves) {
      if (!grouped[m.from]) grouped[m.from] = [];
      grouped[m.from].push(m.to);
    }
    return grouped;
  }
}

const gameManager = {
  createGame(playerName) {
    const playerId = uuidv4();
    const gameId = uuidv4().substring(0, 8);
    db.createPlayer(playerId, playerName);
    db.createGame(gameId, playerId);
    const game = new GameInstance(gameId, playerId);
    activeGames.set(gameId, game);
    return { gameId, playerId, color: 'white' };
  },

  joinGame(gameId, playerName) {
    let game = activeGames.get(gameId);
    if (!game) {
      const dbGame = db.getGame(gameId);
      if (!dbGame) return { error: 'Game not found' };
      if (dbGame.status === 'completed') return { error: 'Game already completed' };
      if (dbGame.status === 'active' && dbGame.black_player_id) return { error: 'Game is full' };
      game = new GameInstance(gameId, dbGame.white_player_id);
      if (dbGame.fen) game.chess = new Chess(dbGame.fen);
      game.status = dbGame.status;
      activeGames.set(gameId, game);
    }
    if (game.status !== 'waiting') return { error: 'Game already started or completed' };
    if (game.blackPlayerId) return { error: 'Game is full' };

    const playerId = uuidv4();
    db.createPlayer(playerId, playerName);
    game.blackPlayerId = playerId;
    game.status = 'active';
    db.joinGame(gameId, playerId);
    return { gameId, playerId, color: 'black' };
  },

  reconnectToGame(gameId, playerId) {
    let game = activeGames.get(gameId);
    if (!game) {
      const dbGame = db.getGame(gameId);
      if (!dbGame) return { error: 'Game not found' };
      if (dbGame.status === 'completed') {
        return {
          gameId, playerId,
          color: playerId === dbGame.white_player_id ? 'white' : 'black',
          completed: true, result: dbGame.result, fen: dbGame.fen
        };
      }
      game = new GameInstance(gameId, dbGame.white_player_id);
      game.blackPlayerId = dbGame.black_player_id;
      if (dbGame.fen) game.chess = new Chess(dbGame.fen);
      game.status = dbGame.status;
      const moves = db.getGameMoves(gameId);
      game.moveCount = moves.length;
      activeGames.set(gameId, game);
    }
    const color = game.getPlayerColor(playerId);
    if (!color) return { error: 'You are not in this game' };
    return { gameId, playerId, color, reconnected: true };
  },

  getGame(gameId) {
    return activeGames.get(gameId);
  },

  removeGame(gameId) {
    activeGames.delete(gameId);
  }
};

module.exports = gameManager;
