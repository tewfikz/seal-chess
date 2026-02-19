/**
 * Crab Chess - Integration Test Suite
 * Tests multiplayer game flow, persistence, scoring, and edge cases
 *
 * Run: npm test (with server NOT running - test starts its own)
 */
const http = require('http');
const { promisify } = require('util');

const BASE = 'http://localhost:3099';
let serverProcess = null;
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: () => JSON.parse(data), text: () => data });
        } catch (e) {
          resolve({ status: res.statusCode, json: () => ({}), text: () => data });
        }
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function startServer() {
  const path = require('path');
  const { spawn } = require('child_process');

  // Clean up old test DB
  const fs = require('fs');
  const dbPath = path.join(__dirname, '..', 'data', 'chess.db');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch (e) {}

  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: '3099' };
    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('running on')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    setTimeout(() => resolve(), 3000);
  });
}

async function testGameCreation() {
  console.log('\n--- Game Creation Tests ---');

  // Valid creation
  const res = await post(`${BASE}/api/games`, { playerName: 'Alice' });
  const data = res.json();
  assert(res.status === 200, 'Create game returns 200');
  assert(data.gameId && data.gameId.length > 0, 'Game ID is generated');
  assert(data.playerId && data.playerId.length > 0, 'Player ID is generated');
  assert(data.color === 'white', 'Creator is assigned white');

  // Empty name
  const res2 = await post(`${BASE}/api/games`, { playerName: '' });
  assert(res2.status === 400, 'Empty name returns 400');

  // XSS name
  const res3 = await post(`${BASE}/api/games`, { playerName: '<script>alert(1)</script>' });
  const data3 = res3.json();
  assert(res3.status === 200, 'XSS name is sanitized, not rejected');
  assert(!data3.error, 'Sanitized name creates game successfully');

  return data;
}

async function testGameJoining(game1) {
  console.log('\n--- Game Joining Tests ---');

  // Valid join
  const res = await post(`${BASE}/api/games/${game1.gameId}/join`, { playerName: 'Bob' });
  const data = res.json();
  assert(res.status === 200, 'Join game returns 200');
  assert(data.color === 'black', 'Joiner is assigned black');
  assert(data.playerId && data.playerId.length > 0, 'Joiner gets player ID');

  // Double join
  const res2 = await post(`${BASE}/api/games/${game1.gameId}/join`, { playerName: 'Charlie' });
  assert(res2.status === 400, 'Double join returns 400');

  // Invalid game
  const res3 = await post(`${BASE}/api/games/nonexistent/join`, { playerName: 'Dave' });
  assert(res3.status === 400, 'Join nonexistent game returns 400');

  return data;
}

async function testGameInfo(gameId) {
  console.log('\n--- Game Info Tests ---');

  const res = await fetch(`${BASE}/api/games/${gameId}`);
  const data = res.json();
  assert(res.status === 200, 'Get game info returns 200');
  assert(data.status === 'active', 'Game status is active after join');
  assert(data.whiteName === 'Alice', 'White player name stored');
  assert(data.blackName === 'Bob', 'Black player name stored');

  // Nonexistent game
  const res2 = await fetch(`${BASE}/api/games/nonexistent`);
  assert(res2.status === 404, 'Nonexistent game returns 404');
}

async function testSocketMultiplayer(gameId, player1Id, player2Id) {
  console.log('\n--- Socket.IO Multiplayer Tests ---');

  // Use socket.io-client from the installed deps
  const { io } = require('socket.io-client');

  return new Promise((resolve) => {
    const socket1 = io(BASE, { transports: ['websocket'] });
    const socket2 = io(BASE, { transports: ['websocket'] });

    let gameStatesReceived = 0;
    let moveMadeCount = 0;

    socket1.on('connect', () => {
      socket1.emit('join-game', { gameId, playerId: player1Id });
    });

    socket2.on('connect', () => {
      socket2.emit('join-game', { gameId, playerId: player2Id });
    });

    socket1.on('game-state', (state) => {
      gameStatesReceived++;
      assert(state.yourColor === 'white', 'Player 1 gets white color');
      assert(state.status === 'active', 'Game state is active');
      assert(state.turn === 'white', 'Initial turn is white');
      assert(Object.keys(state.legalMoves).length > 0, 'White has legal moves');

      // Make a move after both connected
      setTimeout(() => {
        socket1.emit('make-move', { from: 'e2', to: 'e4' });
      }, 500);
    });

    socket2.on('game-state', (state) => {
      gameStatesReceived++;
      assert(state.yourColor === 'black', 'Player 2 gets black color');
    });

    let moveSequence = 0;

    socket2.on('move-made', (data) => {
      moveMadeCount++;
      if (moveSequence === 0) {
        assert(data.san === 'e4', 'First move is e4');
        assert(data.turn === 'black', 'Turn switches to black after white move');
        assert(data.from === 'e2' && data.to === 'e4', 'Move from/to correct');

        // Black responds
        moveSequence = 1;
        setTimeout(() => {
          socket2.emit('make-move', { from: 'e7', to: 'e5' });
        }, 200);
      }
    });

    socket1.on('move-made', (data) => {
      if (moveSequence === 1 && data.san === 'e5') {
        assert(data.san === 'e5', 'Black move is e5');
        assert(data.turn === 'white', 'Turn switches back to white');
        moveSequence = 2;

        // Test illegal move - black trying to move on white's turn
        socket2.emit('make-move', { from: 'd7', to: 'd5' });
      }
    });

    socket2.on('move-rejected', (data) => {
      assert(data.error === 'Not your turn', 'Illegal move rejected: not your turn');

      // Test resignation
      socket2.emit('resign');
    });

    let gameOverReceived = 0;
    function handleGameOver(data) {
      gameOverReceived++;
      if (gameOverReceived === 1) {
        assert(data.type === 'resignation', 'Game over by resignation');
        assert(data.winner === 'white', 'White wins on black resignation');
        assert(data.result === 'white_wins', 'Result is white_wins');

        // Cleanup
        socket1.disconnect();
        socket2.disconnect();

        setTimeout(resolve, 500);
      }
    }

    socket1.on('game-over', handleGameOver);
    socket2.on('game-over', handleGameOver);

    // Timeout safety
    setTimeout(() => {
      socket1.disconnect();
      socket2.disconnect();
      resolve();
    }, 10000);
  });
}

async function testPersistence(gameId) {
  console.log('\n--- Persistence Tests ---');

  // Check game in DB
  const res = await fetch(`${BASE}/api/games/${gameId}`);
  const data = res.json();
  assert(data.status === 'completed', 'Game marked completed in DB');
  assert(data.result === 'white_wins', 'Game result persisted');

  // Check moves
  const movesRes = await fetch(`${BASE}/api/games/${gameId}/moves`);
  const moves = movesRes.json();
  assert(Array.isArray(moves), 'Moves returned as array');
  assert(moves.length === 2, 'Both moves persisted (e4 and e5)');
  assert(moves[0].san === 'e4', 'First move is e4');
  assert(moves[1].san === 'e5', 'Second move is e5');
}

async function testScoring() {
  console.log('\n--- Scoring & Leaderboard Tests ---');

  const res = await fetch(`${BASE}/api/leaderboard`);
  const lb = res.json();
  assert(Array.isArray(lb), 'Leaderboard is an array');
  assert(lb.length > 0, 'Leaderboard has entries');

  const alice = lb.find(p => p.display_name === 'Alice');
  const bob = lb.find(p => p.display_name === 'Bob');

  assert(alice !== undefined, 'Alice in leaderboard');
  assert(bob !== undefined, 'Bob in leaderboard');

  if (alice && bob) {
    assert(alice.wins === 1, 'Alice has 1 win');
    assert(alice.losses === 0, 'Alice has 0 losses');
    assert(alice.score === 3, 'Alice score is 3 (Win = 3 points)');

    assert(bob.wins === 0, 'Bob has 0 wins');
    assert(bob.losses === 1, 'Bob has 1 loss');
    assert(bob.score === 0, 'Bob score is 0 (Loss = 0 points)');

    assert(lb.indexOf(alice) < lb.indexOf(bob), 'Alice ranked higher than Bob');
  }
}

async function testStats() {
  console.log('\n--- Stats Tests ---');

  const res = await fetch(`${BASE}/api/stats`);
  const stats = res.json();
  assert(stats.totalGames >= 1, 'At least 1 completed game');
  assert(stats.totalPlayers >= 2, 'At least 2 players');
}

async function testRecentGames() {
  console.log('\n--- Recent Games Tests ---');

  const res = await fetch(`${BASE}/api/recent-games`);
  const games = res.json();
  assert(Array.isArray(games), 'Recent games is array');
  assert(games.length >= 1, 'At least 1 recent game');
  if (games.length > 0) {
    assert(games[0].white_name === 'Alice', 'Recent game shows white name');
    assert(games[0].black_name === 'Bob', 'Recent game shows black name');
    assert(games[0].result === 'white_wins', 'Recent game shows result');
  }
}

async function testReconnect(gameId, playerId) {
  console.log('\n--- Reconnect Tests ---');

  const res = await post(`${BASE}/api/games/${gameId}/reconnect`, { playerId });
  const data = res.json();
  assert(data.completed === true || data.reconnected === true || data.gameId === gameId,
    'Reconnect returns game info');

  // Invalid reconnect
  const res2 = await post(`${BASE}/api/games/${gameId}/reconnect`, { playerId: 'fake-id' });
  assert(res2.status === 400, 'Invalid reconnect returns 400');
}

async function runAll() {
  console.log('=== Crab Chess Integration Tests ===\n');
  console.log('Starting test server on port 3099...');

  try {
    await startServer();
    await sleep(1000);
    console.log('Server started.');

    const game = await testGameCreation();
    const joiner = await testGameJoining(game);
    await testGameInfo(game.gameId);
    await testSocketMultiplayer(game.gameId, game.playerId, joiner.playerId);
    await sleep(500);
    await testPersistence(game.gameId);
    await testScoring();
    await testStats();
    await testRecentGames();
    await testReconnect(game.gameId, game.playerId);

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

    if (failed > 0) {
      console.log('\nSome tests failed!');
      process.exitCode = 1;
    } else {
      console.log('\nAll tests passed!');
    }
  } catch (e) {
    console.error('Test error:', e);
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
    setTimeout(() => process.exit(process.exitCode || 0), 1000);
  }
}

runAll();
