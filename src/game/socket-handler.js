const gameManager = require('./game-manager');
const db = require('../db');

const DISCONNECT_TIMEOUT = 60000;

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    let currentGameId = null;
    let currentPlayerId = null;

    socket.on('join-game', ({ gameId, playerId }) => {
      const game = gameManager.getGame(gameId);
      if (!game) {
        socket.emit('error-msg', { message: 'Game not found' });
        return;
      }

      const color = game.getPlayerColor(playerId);
      if (!color) {
        socket.emit('error-msg', { message: 'Not a player in this game' });
        return;
      }

      currentGameId = gameId;
      currentPlayerId = playerId;
      socket.join(gameId);

      if (color === 'white') {
        game.whiteSocketId = socket.id;
        game.whiteConnected = true;
      } else {
        game.blackSocketId = socket.id;
        game.blackConnected = true;
      }

      if (game.disconnectTimers[playerId]) {
        clearTimeout(game.disconnectTimers[playerId]);
        delete game.disconnectTimers[playerId];
      }

      const whitePlayer = db.getPlayer(game.whitePlayerId);
      const blackPlayer = game.blackPlayerId ? db.getPlayer(game.blackPlayerId) : null;

      socket.emit('game-state', {
        ...game.getState(),
        whiteName: whitePlayer?.display_name || 'Waiting...',
        blackName: blackPlayer?.display_name || 'Waiting...',
        yourColor: color
      });

      socket.to(gameId).emit('player-connected', {
        color,
        name: color === 'white' ? whitePlayer?.display_name : blackPlayer?.display_name
      });

      if (game.whiteConnected && game.blackConnected && game.status === 'active' && !game.gameReadySent) {
        game.gameReadySent = true;
        io.to(gameId).emit('game-ready', {
          whiteName: whitePlayer?.display_name,
          blackName: blackPlayer?.display_name
        });
      }
    });

    socket.on('make-move', ({ from, to, promotion }) => {
      if (!currentGameId || !currentPlayerId) return;
      const game = gameManager.getGame(currentGameId);
      if (!game) return;

      const result = game.makeMove(currentPlayerId, from, to, promotion);
      if (!result.success) {
        socket.emit('move-rejected', { error: result.error });
        return;
      }

      io.to(currentGameId).emit('move-made', {
        from, to, promotion,
        san: result.move.san,
        fen: result.fen,
        turn: game.chess.turn() === 'w' ? 'white' : 'black',
        inCheck: result.inCheck,
        moveNumber: result.moveNumber,
        captured: result.move.captured || null,
        piece: result.move.piece,
        legalMoves: game.getLegalMoves()
      });

      if (result.gameResult) {
        const whitePlayer = db.getPlayer(game.whitePlayerId);
        const blackPlayer = db.getPlayer(game.blackPlayerId);
        io.to(currentGameId).emit('game-over', {
          ...result.gameResult,
          whiteScore: whitePlayer.score,
          blackScore: blackPlayer.score,
          whiteName: whitePlayer.display_name,
          blackName: blackPlayer.display_name
        });
        setTimeout(() => gameManager.removeGame(currentGameId), 300000);
      }
    });

    socket.on('resign', () => {
      if (!currentGameId || !currentPlayerId) return;
      const game = gameManager.getGame(currentGameId);
      if (!game) return;
      const result = game.resign(currentPlayerId);
      if (result) {
        const whitePlayer = db.getPlayer(game.whitePlayerId);
        const blackPlayer = db.getPlayer(game.blackPlayerId);
        io.to(currentGameId).emit('game-over', {
          ...result,
          whiteName: whitePlayer.display_name,
          blackName: blackPlayer.display_name,
          whiteScore: whitePlayer.score,
          blackScore: blackPlayer.score
        });
      }
    });

    socket.on('offer-draw', () => {
      if (!currentGameId || !currentPlayerId) return;
      const game = gameManager.getGame(currentGameId);
      if (!game) return;
      const result = game.offerDraw(currentPlayerId);
      if (result) {
        socket.to(currentGameId).emit('draw-offered', result);
      }
    });

    socket.on('accept-draw', () => {
      if (!currentGameId || !currentPlayerId) return;
      const game = gameManager.getGame(currentGameId);
      if (!game) return;
      const result = game.acceptDraw(currentPlayerId);
      if (result) {
        const whitePlayer = db.getPlayer(game.whitePlayerId);
        const blackPlayer = db.getPlayer(game.blackPlayerId);
        io.to(currentGameId).emit('game-over', {
          ...result,
          whiteName: whitePlayer.display_name,
          blackName: blackPlayer.display_name,
          whiteScore: whitePlayer.score,
          blackScore: blackPlayer.score
        });
      }
    });

    socket.on('decline-draw', () => {
      if (!currentGameId || !currentPlayerId) return;
      const game = gameManager.getGame(currentGameId);
      if (!game) return;
      const result = game.declineDraw(currentPlayerId);
      if (result) {
        socket.to(currentGameId).emit('draw-declined');
      }
    });

    socket.on('disconnect', () => {
      if (!currentGameId || !currentPlayerId) return;
      const game = gameManager.getGame(currentGameId);
      if (!game) return;

      const color = game.getPlayerColor(currentPlayerId);
      if (color === 'white') {
        game.whiteConnected = false;
        game.whiteSocketId = null;
      } else {
        game.blackConnected = false;
        game.blackSocketId = null;
      }

      socket.to(currentGameId).emit('player-disconnected', { color });

      if (game.status === 'active') {
        game.disconnectTimers[currentPlayerId] = setTimeout(() => {
          if (game.status === 'active') {
            const abandonColor = game.getPlayerColor(currentPlayerId);
            const winner = abandonColor === 'white' ? 'black' : 'white';
            const result = abandonColor === 'white' ? 'black_wins' : 'white_wins';
            game.endGame(result);
            io.to(currentGameId).emit('game-over', {
              type: 'abandonment', winner, result,
              message: `${abandonColor} player disconnected`
            });
          }
        }, DISCONNECT_TIMEOUT);
      }
    });
  });
}

module.exports = { setupSocketHandlers };
