/**
 * index.js — The CONNECTION + ORCHESTRATOR.
 *
 * This file:
 * 1. Connects to your WhatsApp account (you scan a QR code once).
 * 2. Listens for every incoming message.
 * 3. Saves it to memory (db.js).
 * 4. Asks the brain (gemini.js) to write a reply in your tone.
 * 5. Waits a random human-like delay, shows "typing...", then sends it.
 * 6. On startup, checks for old messages you never replied to, and
 *    answers those too.
 */

require('dotenv').config();
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const db = require('./db');
const { generateReply } = require('./minimax');

const MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS || 1500);
const MAX_DELAY_MS = Number(process.env.MAX_DELAY_MS || 5000);

// ---- STAGED ROLLOUT SETTINGS ----
// While TEST_MODE is true, the bot ONLY replies to numbers in ALLOWED_NUMBERS.
// This lets you test safely with one friend before opening it to everyone.
const TEST_MODE = (process.env.TEST_MODE || 'true').toLowerCase() === 'true';

// Helper to safely load allowed numbers from config/allowed-numbers.json & .env
function getLatestAllowedNumbers() {
  const jsonPath = path.join(__dirname, '..', 'config', 'allowed-numbers.json');
  let fileNumbers = [];
  try {
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(parsed)) {
        fileNumbers = parsed.map((n) => String(n).trim().replace(/[^0-9]/g, '')).filter(Boolean);
      }
    }
  } catch (err) {
    console.error('⚠️ Could not parse config/allowed-numbers.json:', err.message);
  }
  const envNumbers = (process.env.ALLOWED_NUMBERS || '')
    .split(',')
    .map((n) => String(n).trim().replace(/[^0-9]/g, ''))
    .filter(Boolean);

  return Array.from(new Set([...fileNumbers, ...envNumbers]));
}

/**
 * A WhatsApp chat ID (jid) looks like "923001234567@s.whatsapp.net" or "252772515582130@lid".
 * We extract the number part and check it against our allowlist.
 */
function isAllowedChat(chatId, realNumberIfKnown, msg) {
  // Channels/Newsletters are broadcast content
  if (chatId.endsWith('@newsletter')) return false;

  if (!TEST_MODE) return true; // rollout finished, everyone is allowed

  if (chatId.endsWith('@g.us')) return false; // safety: never auto-reply in groups during test mode

  const allowed = getLatestAllowedNumbers();

  // Extract raw numeric digits
  const rawIdNumber = chatId.split('@')[0].replace(/[^0-9]/g, '');
  if (allowed.includes(rawIdNumber)) return true;

  if (realNumberIfKnown) {
    const cleanReal = realNumberIfKnown.split('@')[0].replace(/[^0-9]/g, '');
    if (allowed.includes(cleanReal)) return true;
  }

  if (msg?.key?.participant) {
    const cleanPart = msg.key.participant.split('@')[0].replace(/[^0-9]/g, '');
    if (allowed.includes(cleanPart)) return true;
  }

  return false;
}

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startBot() {
  // This saves your WhatsApp login session to disk (in the "auth" folder)
  // so you do NOT need to scan the QR code every single time you restart.
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, '..', 'auth')
  );

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // set to 'info' if you want to see raw logs
    printQRInTerminal: false, // we handle the QR ourselves below for clarity
  });

  // ---- 1. Connection lifecycle ----
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan this QR code with WhatsApp (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
  });

  // Save login credentials whenever they change
  sock.ev.on('creds.update', saveCreds);

  // ---- 2. Handle incoming messages ----
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // only react to genuinely new messages

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue; // skip your own messages

      const chatId = msg.key.remoteJid;
      // Baileys sometimes includes the real phone number even when the
      // chat is using a hidden LID, in a field called "senderPn".
      // This is NOT guaranteed by WhatsApp/Baileys — it's best-effort only.
      const realNumberIfKnown = msg.key.senderPn || null;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      if (!text) continue; // skip non-text messages for now (images, stickers, etc.)
      if (chatId.endsWith('@newsletter')) continue; // skip WhatsApp Channels/broadcasts entirely

      if (realNumberIfKnown) {
        console.log(
          `📩 New message from ${chatId} (real number if known: ${realNumberIfKnown}): ${text}`
        );
      } else {
        console.log(
          `📩 New message from ${chatId} (no real number available, must use this exact ID): ${text}`
        );
      }

      db.saveMessage({
        chatId,
        sender: 'them',
        text,
        timestamp: Date.now(),
      });

      // Always save to memory (useful history for later), but only
      // actually REPLY if this chat is allowed during test mode.
      if (isAllowedChat(chatId, realNumberIfKnown, msg)) {
        await handleAndReply(sock, chatId);
      } else {
        console.log(`⏸️  TEST_MODE active — skipping reply to ${chatId} (not in allowlist)`);
      }
    }
  });

  return sock;
}

/**
 * Generates a reply for the LATEST unanswered message(s) in a chat,
 * then sends it with a human-like delay and typing indicator.
 */
async function handleAndReply(sock, chatId) {
  const history = db.getRecentHistory(chatId, 20);
  const lastIncoming = [...history].reverse().find((m) => m.sender === 'them');
  if (!lastIncoming) return;

  try {
    const reply = await generateReply(history, lastIncoming.text);

    // Human-like behaviour: show "typing..." then wait, instead of instant reply
    await sock.sendPresenceUpdate('composing', chatId);
    await sleep(randomDelay());
    await sock.sendPresenceUpdate('paused', chatId);

    await sock.sendMessage(chatId, { text: reply });

    db.saveMessage({
      chatId,
      sender: 'me',
      text: reply,
      repliedByBot: 1,
      timestamp: Date.now(),
    });
    db.markReplied(chatId);

    console.log(`🤖 Replied to ${chatId}: ${reply}`);
  } catch (err) {
    if (err.message.startsWith('RATE_LIMIT')) {
      console.error(
        `⏳ Gemini daily/rate limit reached. The bot will try again on the NEXT message. ` +
        `Consider switching GEMINI_MODEL to gemini-2.5-flash-lite in .env for a higher free limit.`
      );
    } else {
      console.error('❌ Failed to generate/send reply:', err.message);
    }
  }
}

startBot();