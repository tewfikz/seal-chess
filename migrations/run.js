const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'chess.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const migration = fs.readFileSync(path.join(__dirname, '001_initial.sql'), 'utf8');
db.exec(migration);

console.log('Migrations completed successfully.');
db.close();
