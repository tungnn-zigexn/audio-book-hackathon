const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../assets/audiobook-prebuilt.db');
const db = new Database(dbPath);

const books = db.prepare('SELECT title FROM books').all();
console.log('Books in prebuilt DB:', JSON.stringify(books, null, 2));

db.close();
