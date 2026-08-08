/**
 * minimax.js — The bot's BRAIN (MiniMax M2.1 version).
 *
 * Drop-in replacement for gemini.js. Same exported function signature,
 * same buildSystemPrompt() idea, but calls MiniMax's OpenAI-compatible
 * Chat Completions endpoint instead of Gemini's.
 *
 * Required env vars:
 *   MINIMAX_API_KEY   - your MiniMax API key
 *   MINIMAX_MODEL     - optional, defaults to "MiniMax-M2.1"
 */

const fs = require('fs');
const path = require('path');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'minimax-m2.1';
const MINIMAX_API_URL = process.env.MINIMAX_API_URL || 'http://localhost:8000/v1/chat/completions';

// DEBUG: show exactly what model name is being used, wrapped in brackets
// so any hidden spaces or extra characters become visible.
console.log(`🔧 Using MiniMax model: [${MINIMAX_MODEL}]`);

/**
 * Build the instruction ("system prompt") that tells MiniMax HOW to behave.
 * Reads directly from config/style-profile.md so you can easily edit prompt instructions.
 */
function buildSystemPrompt() {
  const profilePath = path.join(__dirname, '..', 'config', 'style-profile.md');
  let profileContent = '';
  try {
    if (fs.existsSync(profilePath)) {
      profileContent = fs.readFileSync(profilePath, 'utf8').trim();
    }
  } catch (err) {
    console.error('⚠️ Could not read config/style-profile.md:', err.message);
  }

  if (!profileContent) {
    profileContent = `You are secretly writing WhatsApp replies on behalf of a real person, in their own voice.
Rules you MUST follow:
1. Keep replies short and natural.
2. Be polite and friendly.
3. Never mention you are an AI.`;
  }

  return `${profileContent}\n\nReturn ONLY the reply text. No quotes, no labels, no explanation.`;
}

/**
 * Ask MiniMax to write one reply, given past chat history + the new incoming message.
 *
 * @param {Array<{sender: string, text: string}>} history - recent messages with this contact
 * @param {string} incomingMessage - the new message that just arrived
 * @returns {Promise<string>} the generated reply text
 */
async function generateReply(history, incomingMessage) {
  const historyText = history
    .map((m) => `${m.sender === 'me' ? 'Me' : 'Them'}: ${m.text}`)
    .join('\n');

  const userPrompt = `Here is our recent chat history:\n${historyText || '(no earlier history yet)'}\n\nThey just sent this new message:\n"${incomingMessage}"\n\nWrite my reply now.`;

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 200,
      stream: false,
    }),
  });

  if (response.status === 429) {
    // Rate limit hit. MiniMax doesn't always give a structured retry-after,
    // so fall back to a sensible default if it's missing.
    const errBody = await response.text();
    let retrySeconds = 30;
    try {
      const parsed = JSON.parse(errBody);
      const retryAfterHeader = response.headers.get('retry-after');
      if (retryAfterHeader) {
        retrySeconds = parseInt(retryAfterHeader, 10) || 30;
      } else if (parsed?.error?.retry_after) {
        retrySeconds = parseInt(parsed.error.retry_after, 10) || 30;
      }
    } catch (_) {
      // ignore parse errors, use default
    }
    throw new Error(
      `RATE_LIMIT: MiniMax quota hit. Suggested wait: ${retrySeconds}s. Raw: ${errBody}`
    );
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`MiniMax API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();

  // Some MiniMax deployments also return a top-level base_resp.status_code
  // even on HTTP 200. Check it defensively.
  if (data?.base_resp && data.base_resp.status_code && data.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax API returned an error status: ${JSON.stringify(data.base_resp)}`
    );
  }

  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('MiniMax returned no text. Full response: ' + JSON.stringify(data));
  }

  return text.trim();
}

module.exports = { generateReply };