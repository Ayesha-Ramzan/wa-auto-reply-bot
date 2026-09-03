<div align="center">

# wa-auto-reply-bot

A WhatsApp auto-reply bot that answers like *you* would — not like a chatbot.

Node.js · Baileys · SQLite · any OpenAI-compatible LLM endpoint

</div>

---

Most auto-reply tools sound like customer service. This one doesn't. It connects to your own WhatsApp account, keeps real context for every conversation, and drafts replies in a voice you fully control through one editable text file. The result feels less like a bot and more like you, typing.

It's built for personal use — a spare number, a busy schedule, and conversations you don't want to leave hanging.

## What it actually does

- **Logs in once.** You scan a QR code in the terminal; the session is saved to `auth/` and persists across restarts.
- **Remembers every conversation.** Incoming messages are stored in a local SQLite file, so the bot has the last 20 messages of context per chat — no database server needed.
- **Replies in your voice.** The entire personality lives in [`config/style-profile.md`](config/style-profile.md): tone, formality, greeting habits, example replies, hard rules, even what to do when someone tries to rename the bot. Edit the file, restart, done — no code changes.
- **Types like a person.** Before sending, it shows WhatsApp's "typing…" indicator and waits a random interval (configurable, 1.5–5s by default) so replies don't land instantly and robotically.
- **Rolls out safely.** While `TEST_MODE=true`, only numbers on your allowlist get replies — test with one friend before opening it to everyone.
- **Works with any model.** It talks to any OpenAI-compatible `/v1/chat/completions` endpoint: MiniMax, OpenRouter, a local llama.cpp server, your own proxy. The env vars are named `MINIMAX_*` for historical reasons; point `MINIMAX_API_URL` wherever you like.
- **Fails gracefully.** Rate limits (`429`) are caught and logged instead of crashing the bot; it just tries again on the next message.

## How the pieces fit

```
friend texts you
      │
      ▼
src/index.js ──── Baileys connection, message routing, delays, sending
      │
      ▼
src/db.js ─────── SQLite memory: last 20 messages per chat
      │
      ▼
src/minimax.js ── builds the prompt (style profile + history) and calls the model
      │
      ▼
reply sent, after a human-like "typing…" pause
```

| File | Role |
|---|---|
| `src/index.js` | Connection, reconnects, who gets a reply, the send-with-delay flow |
| `src/db.js` | The bot's memory — one SQLite file, one `messages` table |
| `src/minimax.js` | The brain — reads the style profile, calls the LLM, returns clean text |
| `config/style-profile.md` | The entire personality, in one editable file. **Start here.** |

## Quick start

**You'll need:** Node.js 18+, and — strongly recommended — a spare WhatsApp number. See the [safety section](#before-you-run-it) for why.

```bash
git clone https://github.com/Ayesha-Ramzan/wa-auto-reply-bot.git
cd wa-auto-reply-bot
npm install
cp env.example .env
```

Fill in `.env`:

```env
MINIMAX_API_KEY=your_key_here
MINIMAX_MODEL=minimax-m2.1                                  # whatever your endpoint serves
MINIMAX_API_URL=http://localhost:8000/v1/chat/completions   # or any OpenAI-compatible URL

MIN_DELAY_MS=1500
MAX_DELAY_MS=5000
```

Add the numbers the bot should reply to in `config/allowed-numbers.json`:

```json
["923001234567", "923009876543"]
```

Digits only — no `+`, no `@s.whatsapp.net`. The bot normalizes them itself.

Then open `config/style-profile.md` and make it yours. Greetings, length, formality, example replies, things the bot must never say — it all lives there. If you only edit one file in this repo, make it that one.

Run it:

```bash
npm start
```

A QR code appears in the terminal. On your phone: **Settings → Linked Devices → Link a Device**, scan, and you're connected. The session saves to `auth/`, so the next start needs no scan.

```
✅ Connected to WhatsApp!
📩 New message from 923001234567@s.whatsapp.net: hey
🤖 Replied to 923001234567@s.whatsapp.net: hey, what's up
```

## Keeping it running

On Linux, a user-level systemd service works well:

```bash
mkdir -p ~/.config/systemd/user
$EDITOR ~/.config/systemd/user/whatsapp-bot.service
```

```ini
[Unit]
Description=WhatsApp Auto Reply Bot

[Service]
WorkingDirectory=/home/YOUR_USERNAME/wa-auto-reply-bot
ExecStart=/usr/bin/node src/index.js
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-bot.service
journalctl --user -u whatsapp-bot.service -f
```

## Configuration reference

| Env var | Default | What it does |
|---|---|---|
| `MINIMAX_API_KEY` | — | Bearer token for the model endpoint |
| `MINIMAX_MODEL` | `minimax-m2.1` | Model name sent in the request body |
| `MINIMAX_API_URL` | `http://localhost:8000/v1/chat/completions` | OpenAI-compatible chat completions URL |
| `MIN_DELAY_MS` | `1500` | Lower bound of the pre-send delay |
| `MAX_DELAY_MS` | `5000` | Upper bound of the pre-send delay |
| `TEST_MODE` | `true` | When `true`, only allowlisted numbers get replies |
| `ALLOWED_NUMBERS` | *(empty)* | Comma-separated numbers, in addition to `config/allowed-numbers.json` |

The allowlist check tries the chat ID, the real phone number from `senderPn` (when WhatsApp exposes it — not guaranteed), and the message participant, so it still works with hidden LID chats. Channels (`@newsletter`) are always ignored, and groups are skipped while `TEST_MODE=true`.

## Project layout

```
wa-auto-reply-bot/
├── src/
│   ├── index.js               # connection + orchestrator
│   ├── db.js                  # SQLite memory (per-chat history)
│   └── minimax.js             # the brain (LLM client)
├── config/
│   ├── style-profile.md       # the personality — edit this
│   └── allowed-numbers.json   # test-mode allowlist (gitignored)
├── auth/                      # WhatsApp session (gitignored — never share)
├── bot-memory.sqlite          # created on first run (gitignored)
├── env.example
└── package.json
```

## Before you run it

An honest list, because this project deserves one:

- **Baileys is unofficial.** It reverse-engineers WhatsApp Web, and WhatsApp doesn't support that. **There is a real, non-zero ban risk** — especially on your primary number. Use a spare number if you can.
- **Never commit `auth/`, `.env`, or `bot-memory.sqlite`.** They contain your live WhatsApp session, your API keys, and your chat history. The `.gitignore` already covers them; don't override it.
- **Your model endpoint has limits.** The bot handles `429`s gracefully, but it won't make rate limits disappear.
- **This is a personal tool, not a platform.** Don't point it at customer inboxes or shared numbers.
- **The bot refuses identity hijacks by design.** Whoever is texting can't rename it, assign it a new persona, or override its instructions — that's a property of the style profile, not a bug.

## Known limitations

- **Media messages** (images, voice notes, stickers, documents) are silently skipped — only text is processed.
- **Backlog replies on startup** aren't wired up yet. `db.getUnansweredMessages()` exists, but `index.js` doesn't call it on connect; doing it properly requires WhatsApp's history-sync, which is fiddly across Baileys versions. Planned, not shipped.
- **Group replies** stay disabled while `TEST_MODE=true`, on purpose.

## Contributing

Issues and PRs are welcome. Please read the safety section first — this project involves an unofficial WhatsApp client and personal API keys, so "just run it on your main number" testing advice will be politely declined.

## License

No license file yet — all rights reserved by the author until one is added. Want to reuse this? Open an issue or reach out first.
