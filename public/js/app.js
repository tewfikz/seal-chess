/**
 * Crab Chess - Main Application Controller
 * Handles lobby flow, Socket.IO communication, and game state management
 */
(function () {
  'use strict';

  // === STATE ===
  let socket = null;
  let gameId = null;
  let playerId = null;
  let myColor = null;
  let board = null;
  let currentTurn = 'white';
  let gameActive = false;

  // === DOM REFS ===
  const $ = (sel) => document.querySelector(sel);
  const lobbyScreen = $('#lobby-screen');
  const gameScreen = $('#game-screen');
  const createSection = $('#create-section');
  const joinSection = $('#join-section');
  const inviteSection = $('#invite-section');

  // === INIT ===
  function init() {
    // Check if we're on a game URL
    const pathMatch = window.location.pathname.match(/^\/game\/([a-zA-Z0-9-]+)/);

    // Check for reconnection data
    const stored = loadSession();

    if (pathMatch) {
      const urlGameId = pathMatch[1];
      if (stored && stored.gameId === urlGameId && stored.playerId) {
        // Attempt reconnection
        attemptReconnect(urlGameId, stored.playerId);
      } else {
        // Show join form
        showJoinForm(urlGameId);
      }
    } else if (stored && stored.gameId && stored.playerId) {
      // On homepage but have stored session - offer reconnect
      attemptReconnect(stored.gameId, stored.playerId);
    } else {
      showLobby();
    }

    bindLobbyEvents();
  }

  // === SESSION STORAGE ===
  function saveSession(gId, pId, color) {
    try {
      localStorage.setItem('crab_chess_session', JSON.stringify({ gameId: gId, playerId: pId, color }));
    } catch (e) { /* ignore */ }
  }

  function loadSession() {
    try {
      const data = localStorage.getItem('crab_chess_session');
      return data ? JSON.parse(data) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem('crab_chess_session'); } catch (e) { /* ignore */ }
  }

  // === LOBBY ===
  function showLobby() {
    lobbyScreen.classList.add('active');
    gameScreen.classList.remove('active');
    createSection.style.display = '';
    joinSection.style.display = 'none';
    inviteSection.style.display = 'none';
  }

  function showJoinForm(gId) {
    gameId = gId;
    lobbyScreen.classList.add('active');
    gameScreen.classList.remove('active');
    createSection.style.display = 'none';
    joinSection.style.display = '';
    inviteSection.style.display = 'none';

    // Fetch game info
    fetch(`/api/games/${gId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          $('#join-game-info').textContent = 'Game not found or already completed.';
          $('#join-btn').disabled = true;
        } else if (data.status === 'waiting') {
          $('#join-game-info').textContent = `${data.whiteName} is waiting for an opponent.`;
        } else if (data.status === 'active') {
          $('#join-game-info').textContent = 'This game is already in progress.';
          $('#join-btn').disabled = true;
        } else {
          $('#join-game-info').textContent = 'This game has ended.';
          $('#join-btn').disabled = true;
        }
      })
      .catch(() => {
        $('#join-game-info').textContent = 'Could not load game info.';
      });
  }

  function showInviteScreen(gId) {
    createSection.style.display = 'none';
    joinSection.style.display = 'none';
    inviteSection.style.display = '';

    const link = `${window.location.origin}/game/${gId}`;
    $('#invite-link').value = link;
  }

  function bindLobbyEvents() {
    // Create game
    $('#create-btn').addEventListener('click', async () => {
      const name = $('#create-name').value.trim();
      if (!name) { $('#create-name').focus(); return; }

      $('#create-btn').disabled = true;
      try {
        const res = await fetch('/api/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName: name })
        });
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        gameId = data.gameId;
        playerId = data.playerId;
        myColor = data.color;
        saveSession(gameId, playerId, myColor);

        // Update URL
        history.pushState(null, '', `/game/${gameId}`);

        showInviteScreen(gameId);
        connectSocket();
      } catch (e) {
        alert('Failed to create game. Please try again.');
      } finally {
        $('#create-btn').disabled = false;
      }
    });

    // Join game
    $('#join-btn').addEventListener('click', async () => {
      const name = $('#join-name').value.trim();
      if (!name) { $('#join-name').focus(); return; }

      $('#join-btn').disabled = true;
      try {
        const res = await fetch(`/api/games/${gameId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName: name })
        });
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        playerId = data.playerId;
        myColor = data.color;
        saveSession(gameId, playerId, myColor);

        switchToGameScreen();
        connectSocket();
      } catch (e) {
        alert('Failed to join game. Please try again.');
      } finally {
        $('#join-btn').disabled = false;
      }
    });

    // Copy invite link
    $('#copy-link-btn').addEventListener('click', () => {
      const input = $('#invite-link');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        $('#copy-link-btn').textContent = 'Copied!';
        setTimeout(() => { $('#copy-link-btn').textContent = 'Copy'; }, 2000);
      }).catch(() => {
        // Fallback
        document.execCommand('copy');
        $('#copy-link-btn').textContent = 'Copied!';
        setTimeout(() => { $('#copy-link-btn').textContent = 'Copy'; }, 2000);
      });
    });

    // Enter key on name inputs
    $('#create-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#create-btn').click();
    });
    $('#join-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#join-btn').click();
    });

    // Game controls
    $('#resign-btn').addEventListener('click', () => {
      if (confirm('Are you sure you want to resign?')) {
        socket.emit('resign');
      }
    });

    $('#draw-btn').addEventListener('click', () => {
      socket.emit('offer-draw');
      $('#draw-btn').disabled = true;
      $('#draw-btn').textContent = 'Draw Offered';
      setTimeout(() => {
        $('#draw-btn').disabled = false;
        $('#draw-btn').textContent = 'Offer Draw';
      }, 5000);
    });

    $('#accept-draw-btn').addEventListener('click', () => {
      socket.emit('accept-draw');
      $('#draw-offer-popup').style.display = 'none';
    });

    $('#decline-draw-btn').addEventListener('click', () => {
      socket.emit('decline-draw');
      $('#draw-offer-popup').style.display = 'none';
    });

    // New game button (game over overlay)
    $('#new-game-btn').addEventListener('click', () => {
      resetToLobby();
    });

    // Cancel game button (invite screen)
    $('#cancel-game-btn').addEventListener('click', () => {
      resetToLobby();
    });

    // Leave game button (during game)
    $('#leave-game-btn').addEventListener('click', () => {
      if (gameActive) {
        if (!confirm('Leave the game? You may lose by abandonment if you don\'t return.')) return;
      }
      resetToLobby();
    });

    // Promotion buttons
    document.querySelectorAll('.promotion-piece').forEach(btn => {
      btn.addEventListener('click', () => {
        const piece = btn.dataset.piece;
        $('#promotion-dialog').style.display = 'none';
        if (board) board.resolvePromotion(piece);
      });
    });
  }

  // === RECONNECT ===
  async function attemptReconnect(gId, pId) {
    try {
      const res = await fetch(`/api/games/${gId}/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: pId })
      });
      const data = await res.json();

      if (data.error) {
        clearSession();
        showLobby();
        return;
      }

      gameId = data.gameId;
      playerId = data.playerId;
      myColor = data.color;

      if (data.completed) {
        clearSession();
        showLobby();
        return;
      }

      saveSession(gameId, playerId, myColor);
      switchToGameScreen();
      connectSocket();
    } catch (e) {
      clearSession();
      showLobby();
    }
  }

  // === RESET ===
  function resetToLobby() {
    clearSession();
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    gameId = null;
    playerId = null;
    myColor = null;
    board = null;
    currentTurn = 'white';
    gameActive = false;
    moveHistoryMoves = [];

    // Clear UI state
    $('#move-list').innerHTML = '';
    $('#self-captured').innerHTML = '';
    $('#opponent-captured').innerHTML = '';
    $('#game-over-overlay').style.display = 'none';
    $('#draw-offer-popup').style.display = 'none';
    $('#promotion-dialog').style.display = 'none';
    $('#resign-btn').style.display = 'none';
    $('#draw-btn').style.display = 'none';
    $('#board').innerHTML = '';
    $('#create-name').value = '';
    $('#create-btn').disabled = false;

    // Reset URL and show lobby
    history.pushState(null, '', '/');
    showLobby();
  }

  // === GAME SCREEN ===
  function switchToGameScreen() {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');

    // Initialize board
    const boardEl = $('#board');
    board = new ChessBoard(boardEl, {
      orientation: myColor,
      interactive: false,
      onMove: (from, to, promotion) => {
        socket.emit('make-move', { from, to, promotion });
      },
      onPromotionNeeded: () => {
        $('#promotion-dialog').style.display = '';
      }
    });
  }

  // === SOCKET.IO ===
  function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('join-game', { gameId, playerId });
    });

    socket.on('game-state', (state) => {
      // If game is still waiting for opponent, stay on invite screen
      if (state.status === 'waiting') {
        return;
      }

      // Game is active or completed — switch to game screen
      if (!board) {
        switchToGameScreen();
      }
      lobbyScreen.classList.remove('active');
      gameScreen.classList.add('active');

      // Set board position
      board.setPosition(state.fen);
      board.setLegalMoves(state.yourColor === state.turn ? state.legalMoves : {});
      board.setInteractive(state.status === 'active' && state.yourColor === state.turn);

      // Player names
      const isWhite = myColor === 'white';
      $('#self-name').textContent = isWhite ? state.whiteName : state.blackName;
      $('#opponent-name').textContent = isWhite ? state.blackName : state.whiteName;

      // Piece icons
      $('#self-piece-icon').innerHTML = `<img src="/assets/pieces/${myColor}_king.svg" alt="">`;
      const oppColor = myColor === 'white' ? 'black' : 'white';
      $('#opponent-piece-icon').innerHTML = `<img src="/assets/pieces/${oppColor}_king.svg" alt="">`;

      // Connection status
      const selfConnected = isWhite ? state.whiteConnected : state.blackConnected;
      const oppConnected = isWhite ? state.blackConnected : state.whiteConnected;
      $('#self-connection').className = `connection-dot ${selfConnected ? 'connected' : ''}`;
      $('#opponent-connection').className = `connection-dot ${oppConnected ? 'connected' : ''}`;

      currentTurn = state.turn;
      gameActive = state.status === 'active';

      updateStatusText();
      updateControls();

      // Check highlight
      if (state.inCheck) {
        const checkColor = state.turn;
        const kingSquare = board.findKing(checkColor);
        if (kingSquare) board.setCheck(kingSquare);
      } else {
        board.clearCheck();
      }
    });

    socket.on('game-ready', (data) => {
      // Both players transition to game screen
      if (!board) {
        switchToGameScreen();
      }
      lobbyScreen.classList.remove('active');
      gameScreen.classList.add('active');

      const isWhite = myColor === 'white';
      $('#self-name').textContent = isWhite ? data.whiteName : data.blackName;
      $('#opponent-name').textContent = isWhite ? data.blackName : data.whiteName;

      // Set piece icons
      $('#self-piece-icon').innerHTML = `<img src="/assets/pieces/${myColor}_king.svg" alt="">`;
      const oppColor = myColor === 'white' ? 'black' : 'white';
      $('#opponent-piece-icon').innerHTML = `<img src="/assets/pieces/${oppColor}_king.svg" alt="">`;

      // Both connected
      $('#self-connection').className = 'connection-dot connected';
      $('#opponent-connection').className = 'connection-dot connected';

      gameActive = true;
      currentTurn = 'white';

      // Set starting position and enable moves for white
      board.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

      // Request full game state to get legal moves
      socket.emit('join-game', { gameId, playerId });
    });

    socket.on('move-made', (data) => {
      board.setPosition(data.fen);
      board.setLastMove(data.from, data.to);
      currentTurn = data.turn;

      // Update legal moves and interactivity
      const isMyTurn = data.turn === myColor;
      board.setLegalMoves(isMyTurn ? data.legalMoves : {});
      board.setInteractive(isMyTurn);

      // Check highlight
      if (data.inCheck) {
        const kingSquare = board.findKing(data.turn);
        if (kingSquare) board.setCheck(kingSquare);
      } else {
        board.clearCheck();
      }

      // Update captured pieces
      if (data.captured) {
        addCapturedPiece(data.captured, data.turn === 'white' ? 'black' : 'white');
      }

      // Update move history
      addMoveToHistory(data.moveNumber, data.san, data.turn === 'black' ? 'white' : 'black');

      updateStatusText();

      // Play sound
      playMoveSound(data.captured);
    });

    socket.on('move-rejected', (data) => {
      // Flash error briefly
      const statusEl = $('#status-text');
      const prev = statusEl.textContent;
      statusEl.textContent = data.error || 'Invalid move';
      $('#game-status').style.color = 'var(--danger)';
      setTimeout(() => {
        statusEl.textContent = prev;
        updateStatusText();
      }, 1500);
    });

    socket.on('player-connected', (data) => {
      if (data.color !== myColor) {
        $('#opponent-connection').className = 'connection-dot connected';
        if (data.name) $('#opponent-name').textContent = data.name;
      }
    });

    socket.on('player-disconnected', (data) => {
      if (data.color !== myColor) {
        $('#opponent-connection').className = 'connection-dot';
      }
    });

    socket.on('draw-offered', () => {
      $('#draw-offer-popup').style.display = '';
    });

    socket.on('draw-declined', () => {
      $('#draw-btn').disabled = false;
      $('#draw-btn').textContent = 'Offer Draw';
    });

    socket.on('game-over', (data) => {
      gameActive = false;
      board.setInteractive(false);
      board.setLegalMoves({});

      let title = 'Game Over';
      let message = '';

      if (data.type === 'checkmate') {
        title = 'Checkmate!';
        message = `${data.winner === myColor ? 'You win' : 'You lose'}!`;
      } else if (data.type === 'stalemate') {
        title = 'Stalemate';
        message = 'The game is a draw.';
      } else if (data.type === 'draw' || data.type === 'draw_agreed') {
        title = 'Draw';
        message = data.reason ? `Draw by ${data.reason}.` : 'The game is a draw by agreement.';
      } else if (data.type === 'resignation') {
        title = 'Resignation';
        message = `${data.winner === myColor ? 'You win' : 'You lose'} by resignation!`;
      } else if (data.type === 'abandonment') {
        title = 'Abandonment';
        message = `${data.winner === myColor ? 'You win' : 'You lose'} - opponent disconnected.`;
      }

      if (data.whiteName && data.blackName) {
        message += `\n${data.whiteName} (White) vs ${data.blackName} (Black)`;
      }

      $('#game-over-title').textContent = title;
      $('#game-over-message').textContent = message;
      $('#game-over-overlay').style.display = '';

      // Hide controls
      $('#resign-btn').style.display = 'none';
      $('#draw-btn').style.display = 'none';
      $('#draw-offer-popup').style.display = 'none';

      clearSession();
    });

    socket.on('error-msg', (data) => {
      alert(data.message || 'An error occurred');
    });

    socket.on('disconnect', () => {
      $('#self-connection').className = 'connection-dot';
    });

    socket.on('reconnect', () => {
      $('#self-connection').className = 'connection-dot connected';
      socket.emit('join-game', { gameId, playerId });
    });
  }

  // === UI HELPERS ===
  function updateStatusText() {
    const statusEl = $('#status-text');
    const gameStatusEl = $('#game-status');

    if (!gameActive) {
      statusEl.textContent = 'Waiting for game to start...';
      gameStatusEl.className = 'game-status';
      return;
    }

    const isMyTurn = currentTurn === myColor;

    if (isMyTurn) {
      statusEl.textContent = 'Your turn';
      gameStatusEl.className = 'game-status your-turn';
    } else {
      statusEl.textContent = "Opponent's turn";
      gameStatusEl.className = 'game-status opponent-turn';
    }
  }

  function updateControls() {
    if (gameActive) {
      $('#resign-btn').style.display = '';
      $('#draw-btn').style.display = '';
    }
  }

  function addCapturedPiece(pieceType, capturedColor) {
    // capturedColor = color of the piece that was captured
    const isOpponentPiece = capturedColor !== myColor;
    const container = isOpponentPiece ? $('#self-captured') : $('#opponent-captured');

    const pieceNames = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    const pieceName = pieceNames[pieceType] || pieceType;

    const img = document.createElement('img');
    img.src = `/assets/pieces/${capturedColor}_${pieceName}.svg`;
    img.alt = `${capturedColor} ${pieceName}`;
    container.appendChild(img);
  }

  let moveHistoryMoves = [];

  function addMoveToHistory(moveNumber, san, movedColor) {
    const moveList = $('#move-list');

    if (movedColor === 'white') {
      // New move pair
      const numEl = document.createElement('span');
      numEl.className = 'move-number';
      numEl.textContent = Math.ceil(moveNumber / 2) + '.';

      const whiteEl = document.createElement('span');
      whiteEl.className = 'move-white';
      whiteEl.textContent = san;

      moveList.appendChild(numEl);
      moveList.appendChild(whiteEl);

      moveHistoryMoves.push({ number: Math.ceil(moveNumber / 2), white: san, black: null });
    } else {
      const blackEl = document.createElement('span');
      blackEl.className = 'move-black';
      blackEl.textContent = san;
      moveList.appendChild(blackEl);

      if (moveHistoryMoves.length > 0) {
        moveHistoryMoves[moveHistoryMoves.length - 1].black = san;
      }
    }

    // Auto-scroll
    moveList.scrollTop = moveList.scrollHeight;
  }

  // Simple move sounds using Web Audio API
  let audioCtx = null;

  function playMoveSound(isCapture) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (isCapture) {
        osc.frequency.value = 300;
        gain.gain.value = 0.15;
        osc.type = 'square';
      } else {
        osc.frequency.value = 500;
        gain.gain.value = 0.08;
        osc.type = 'sine';
      }

      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) { /* audio not supported */ }
  }

  // === START ===
  document.addEventListener('DOMContentLoaded', init);
})();
