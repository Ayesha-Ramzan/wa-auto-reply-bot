/**
 * db.js — The bot's MEMORY.
 *
 * WHY we need this file:
 * The bot must "recognize" who is texting (a specific friend, by their
 * WhatsApp ID) and remember what you and that person already discussed.
 * Without this, the bot would reply to every message with zero context,
 * and it could not match YOUR tone with THAT specific person.
 *
 * We use SQLite because:
 * - It's a single file on disk (no separate database server to run)
 * - It's fast enough for personal use (not thousands of users)
 * - It survives restarts (your chat history is not lost when you turn
 *   the bot off and on again)
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'bot-memory.sqlite'));

// This runs once, creating the table if it does not exist yet.
// A "table" is like a spreadsheet with fixed columns.
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,       -- WhatsApp ID of the person/group (e.g. 923001234567@s.whatsapp.net)
    sender TEXT NOT NULL,        -- 'them' or 'me'
    text TEXT NOT NULL,
    replied_by_bot INTEGER DEFAULT 0,  -- 1 if the bot answered this message
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chat_id ON messages(chat_id);
`);

/**
 * Save one message (yours or theirs) into memory.
 */
function saveMessage({ chatId, sender, text, repliedByBot = 0, timestamp }) {
    const stmt = db.prepare(`
    INSERT INTO messages (chat_id, sender, text, replied_by_bot, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
    stmt.run(chatId, sender, text, repliedByBot, timestamp);
}

/**
 * Get the last N messages with a specific person.
 * This is what we feed to Gemini so it can copy YOUR tone with THIS person.
 */
function getRecentHistory(chatId, limit = 20) {
    const stmt = db.prepare(`
    SELECT sender, text, timestamp FROM messages
    WHERE chat_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
    const rows = stmt.all(chatId, limit);
    return rows.reverse(); // oldest first, so the conversation reads naturally
}

/**
 * Find messages from "them" that were never answered by the bot or by you.
 * This powers your "reply to old unread messages when I turn the bot on" request.
 */
function getUnansweredMessages(chatId) {
    const stmt = db.prepare(`
    SELECT id, text, timestamp FROM messages
    WHERE chat_id = ? AND sender = 'them' AND replied_by_bot = 0
    AND timestamp > (
      SELECT COALESCE(MAX(timestamp), 0) FROM messages
      WHERE chat_id = ? AND sender = 'me'
    )
    ORDER BY timestamp ASC
  `);
    return stmt.all(chatId, chatId);
}

function markReplied(chatId) {
    db.prepare(`
    UPDATE messages SET replied_by_bot = 1
    WHERE chat_id = ? AND sender = 'them' AND replied_by_bot = 0
  `).run(chatId);
}

module.exports = {
    saveMessage,
    getRecentHistory,
    getUnansweredMessages,
    markReplied,
};