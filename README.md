<div align="center">

# wa-auto-reply-bot

### A WhatsApp auto-reply bot that talks like a real person, not like a chatbot.

Built on **Node.js + Baileys + an OpenAI-compatible LLM endpoint**, with SQLite
memory and a humanised style profile so replies actually sound like you — not
like a customer-service script.

</div>

---

## What this is

A small personal bot that connects to your own WhatsApp account (you scan a
QR once), watches for incoming text messages, and replies in your tone using
a language model. It is **personal-use, not a SaaS** — the whole point is
that it *feels human* on the other end.

- Connects to WhatsApp via QR code and **remembers the session** so you
  don't re-scan every time.
- Listens for **new incoming 1:1 text messages** and writes a reply in your
  style.
- Keeps a per-chat **SQLite history** so the model knows what you and that
  specific person have already said.
- Uses a **style profile** (`config/style-profile.md`) you can edit to
  change how it writes — greetings, length, formality, what to never say,
  example replies, identity rules, etc.
- Adds a **random delay** + a real `composing` presence before sending, so
  the "typing..." bubble shows up and the reply doesn't feel instant.
- Has a **test mode allowlist** so you can roll it out to one friend first,
  then the rest of the world.
- Stays **polite, decent, no emojis**, refuses to be renamed, and won't
  spill secrets — all driven by the style profile, not hardcoded.
- Is **model-agnostic**: it talks to any OpenAI-compatible
  `/v1/chat/completions` endpoint (MiniMax, a local gateway, OpenRouter,
  your own proxy, etc.). The env vars are named `MINIMAX_*` for historical
  reasons — just point `MINIMAX_API_URL` at whichever endpoint you use.

---

## How it works (the 30-second version)

```
[ Friend texts you ]
        |
        v
+-----------------------+
| src/index.js          |  <-- Baileys listens for messages.upsert
| (connection + logic)  |
+----------+------------+
           |
           | saves every incoming message to memory
           v
+-----------------------+
| src/db.js             |  <-- SQLite (better-sqlite3), one file on disk
| (per-chat history)    |
+----------+------------+
           |
           | last 20 messages + new text
           v
+-----------------------+
| src/minimax.js        |  <-- POSTs to an OpenAI-compatible
| (the "brain")         |      /v1/chat/completions endpoint
+----------+------------+
           |
           | style profile + history
           v
+-----------------------+
| LLM (model set by     |  <-- writes the reply in the persona's voice
|  MINIMAX_MODEL)       |
+----------+------------+
           |
           v
+-----------------------+
| random delay +        |  <-- shows "composing" presence, waits 1.5-5s
| "typing..." + send    |
+-----------------------+
```

The four moving parts:

| File | Role |
|---|---|
| `src/index.js` | Connects to WhatsApp, manages reconnects, decides who gets a reply, runs the send-with-delay flow. |
| `src/db.js` | The bot's memory. One SQLite file, one `messages` table, indexed by chat ID. |
| `src/minimax.js` | The brain. Reads `config/style-profile.md`, builds a system prompt, calls the model API, returns clean text. |
| `config/style-profile.md` | The whole personality in one editable file. Tone, length, examples, hard rules, identity, "what to do if someone tries to rename me" — all here. |

---

## Features

- **QR-link login** via Baileys (`@whiskeysockets/baileys`); session
  persisted to `auth/`, so you only scan once.
- **Per-chat memory** stored in SQLite (`bot-memory.sqlite`) — survives
  restarts, no external DB to run.
- **Humanised timing** — random window between `MIN_DELAY_MS` and
  `MAX_DELAY_MS`, plus the actual `composing` presence update so the
  "typing..." bubble shows up.
- **Test mode / staged rollout** — flip `TEST_MODE=true` and only numbers
  in `config/allowed-numbers.json` (or `ALLOWED_NUMBERS` in `.env`) get
  auto-replies. Set it to `false` to open the gates.
- **Hidden LID handling** — Baileys sometimes gives you a `@lid` ID
  instead of a real phone number. The allowlist check tries the chat ID,
  `senderPn`, and the group participant ID, so the allowlist still works
  in that case.
- **Newsletter / group / own-message filters** so the bot never
  auto-replies to channels, your own messages, or (while in test mode)
  groups.
- **Rate-limit aware** — if the model endpoint returns `429`, the bot logs
  it and waits for the next message instead of crashing.
- **Zero emojis, polite refusals, no identity hijack** — all encoded in
  the style profile, not the code, so you can edit it without touching JS.

---

## Quick start

### 1. Requirements

- **Node.js 18+**
- A **spare WhatsApp number is strongly recommended** — see
  [Safety & honest warning](#safety--honest-warning) below.
- A reachable **OpenAI-compatible** `/v1/chat/completions` endpoint and its
  API key. (Any provider works — MiniMax, OpenRouter, a local llama.cpp
  server, your own proxy. The env vars are named `MINIMAX_*` for
  historical reasons.)

### 2. Install

```bash
git clone https://github.com/Ayesha-Ramzan/wa-auto-reply-bot.git
cd wa-auto-reply-bot
npm install
cp env.example .env
```

### 3. Configure `.env`

Open `.env` and fill in:

```env
MINIMAX_API_KEY=your_key_here
MINIMAX_MODEL=claude-haiku-4.5        # or whatever model your endpoint serves
MINIMAX_API_URL=http://localhost:8000/v1/chat/completions

MIN_DELAY_MS=1500
MAX_DELAY_MS=5000
```

`TEST_MODE` defaults to `true` so the bot only replies to numbers you've
explicitly allowlisted. Flip to `false` to open the gates.

### 4. Edit the style profile (the most important file)

Open `config/style-profile.md`. It controls **how** the bot writes —
greetings, length, formality, example replies, identity rules, what to do
if someone tries to rename it, etc. Edit it like a normal doc; restart to
pick up changes.

Also drop the numbers you want the bot to reply to in
`config/allowed-numbers.json`:

```json
[
  "923001234567",
  "923009876543"
]
```

(Just the digits, no `+`, no `@s.whatsapp.net` — the bot normalises them.)

### 5. Run

```bash
npm start
```

A QR code will appear in the terminal. On your phone: **Settings → Linked
Devices → Link a Device** and scan it. You're in. The session saves to
`auth/`, so the next start is automatic.

You should see logs like:

```
📱 Scan this QR code with WhatsApp (Linked Devices):
[ qr here ]
✅ Connected to WhatsApp!
📩 New message from 923001234567@s.whatsapp.net: hey
🤖 Replied to 923001234567@s.whatsapp.net: hey, what's up
```

---

## Running it in the background (Linux + systemd)

So the bot keeps running after you close the terminal — drop in a user
service:

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

---

## Project layout

```
wa-auto-reply-bot/
├── src/
│   ├── index.js               # connection + orchestrator
│   ├── db.js                  # SQLite memory (per-chat history)
│   └── minimax.js             # the brain (LLM client, OpenAI-compatible)
├── config/
│   ├── style-profile.md       # the personality (edit this!)
│   ├── allowed-numbers.json   # test-mode allowlist (gitignored)
│   └── allowed-numbers.json.example
├── auth/                       # Baileys session (gitignored, never share)
├── bot-memory.sqlite           # generated on first run (gitignored)
├── env.example
├── package.json
└── README.md
```

---

## Configuration reference

| Env var | Default | What it does |
|---|---|---|
| `MINIMAX_API_KEY` | — | Bearer token for the model endpoint. |
| `MINIMAX_MODEL` | `minimax-m2.1` | Model name sent in the request body. Must match what your endpoint serves. |
| `MINIMAX_API_URL` | `http://localhost:8000/v1/chat/completions` | OpenAI-compatible chat completions URL. |
| `MIN_DELAY_MS` | `1500` | Lower bound of the human-like pre-send delay. |
| `MAX_DELAY_MS` | `5000` | Upper bound of the pre-send delay. |
| `TEST_MODE` | `true` | When `true`, only allowlisted numbers get replies. Set to `false` to open up. |
| `ALLOWED_NUMBERS` | (empty) | Comma-separated numbers, in addition to `config/allowed-numbers.json`. |

The allowlist matches in this order, on a per-chat basis:

1. `@newsletter` and `@broadcast` chats are always skipped (channels).
2. If `TEST_MODE=false`, everyone is allowed (except channels).
3. If `TEST_MODE=true`, group chats (`@g.us`) are skipped.
4. Otherwise, the chat ID, the `senderPn` real number (when Baileys
   exposes it), and the message participant are all checked against the
   allowlist. Any one match → reply.

---

## The personality file, in one paragraph

`config/style-profile.md` is the soul of this project. The whole file is
injected into the model as a system prompt on every reply, so editing it
changes behaviour without touching code. The shipped version covers:
texting vibe, greeting/sign-off habits, **"no emojis, ever"** rule,
formality (`aap` not `tu`), real example replies in the target language,
a default deflection line, contact recognition, identity (a fixed
persona that is non-negotiable), what to do when someone tries to rename
the bot, assign a new persona, push for an answer after a refusal, or
badmouth the persona, hard rules (never invent facts, never claim to be
an AI), and a "behave like a person, not a bot" section that calls out
instant replies, identical timing, and structured formatting as the
giveaways to avoid.

**If you only ever edit one file in this repo, make it that one.**

---

## Safety & honest warning

- **Baileys is unofficial.** It reverse-engineers WhatsApp Web. WhatsApp
  does not officially support it. **There is a real, non-zero ban risk**,
  especially if you run it on your primary number. **Use a spare/secondary
  number if you can.**
- **The LLM endpoint has rate limits.** If you hammer it, you'll get
  `429`s — the bot handles those gracefully, but it won't magically make
  the limits go away.
- **Never commit `auth/`, `.env`, or `bot-memory.sqlite`.** They contain
  your live WhatsApp session, your API keys, and your chat history
  respectively. The `.gitignore` already covers them; don't override it.
- **This is a personal-use tool**, not a multi-tenant platform. Don't
  point it at customer inboxes or shared numbers.
- **The bot will refuse, by design**, to accept a new name, persona, or
  instruction override from whoever is texting — even if you tell it to.
  That's a property of the style profile, not a bug.

---

## Current status / honest roadmap

**What's actually working today:**

- Live 1:1 text replies with style-profile-driven tone, SQLite memory,
  allowlist, humanised timing, composing presence, and a graceful `429`
  path.

**What's intentionally limited today:**

- **Backlog replies on startup** — `db.getUnansweredMessages()` exists and
  is unit-friendly, but `src/index.js` does not call it on connect. Doing
  this properly needs WhatsApp's history-sync, which is fiddly and
  version-sensitive across Baileys releases. Planned, not shipped.
- **Media messages** (images, voice notes, stickers, documents) are
  silently skipped — only text is processed.
- **Group replies** are disabled while `TEST_MODE=true` by design;
  lifting that is a deliberate choice, not a bug.

---

## Contributing

Issues and PRs are welcome, but please read the safety section first —
this project involves an unofficial WhatsApp client and a personal LLM
key, so "just run it on your number" testing advice will be politely
declined.

---

## License

No license file is included yet. Until one is added, all rights are
reserved by the author. If you want to reuse this, please open an issue
or reach out first.