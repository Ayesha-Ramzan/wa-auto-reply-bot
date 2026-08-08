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

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'minimax-m2.1';
const MINIMAX_API_URL = process.env.MINIMAX_API_URL || 'http://localhost:8000/v1/chat/completions';

// DEBUG: show exactly what model name is being used, wrapped in brackets
// so any hidden spaces or extra characters become visible.
console.log(`🔧 Using MiniMax model: [${MINIMAX_MODEL}]`);

/**
 * Sample style examples to guide the bot's tone.
 */
const STYLE_SAMPLES = `Examples of desired tone:
- "Ji, aap kaise hain? Main khairiyat se hoon."
- "Main thodi der mein aap ko reply karti hoon."
- "Thank you so much, aap ka bohot shukriya."`;

/**
 * Build the instruction ("system prompt") that tells MiniMax HOW to behave.
 * This is the most important part for making replies feel like YOU.
 */
function buildSystemPrompt() {
  return `You are secretly writing WhatsApp replies on behalf of a real person, in their own voice.
Rules you MUST follow:
1. Study the chat history given to you and copy the sentence length and
   language mix (Roman Urdu / English) that this specific person uses.
2. Keep replies short and natural, the way real WhatsApp texts look. Do not
   write long paragraphs.
3. Be polite and friendly, never rude, even if the incoming message sounds upset.
4. Never mention that you are an AI, a bot, or an assistant. Never break character.
5. If the message asks something you (the real person) cannot know the answer to
   (like exact plans or private details), reply the way a busy person would:
   acknowledge them and say you'll get back to them properly soon.
6. Reply in the SAME language the person used to text you (Roman Urdu or English).
7. Always use "aap" (formal/respectful), never "tu" or informal "tum". Keep the
   tone decent, polite, and professional — like a well-mannered woman texting.
8. Do not overuse emojis. Use at most one emoji occasionally if it fits naturally,
   otherwise skip emojis entirely. Keep the language clean and measured, not casual slang-heavy.
${STYLE_SAMPLES}
Return ONLY the reply text. No quotes, no labels, no explanation.`;
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