const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes/api');
const { setupSocketHandlers } = require('./game/socket-handler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingTimeout: 30000,
  pingInterval: 10000
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', limiter);

// API routes
app.use('/api', apiRoutes);

// SPA routes
app.get('/game/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/leaderboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'leaderboard.html'));
});

// Socket.IO handlers
setupSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Crab Chess server running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  const db = require('./db');
  db.close();
  server.close();
});
