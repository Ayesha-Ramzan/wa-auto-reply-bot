# WhatsApp Auto-Reply Bot — Setup Guide (Arch Linux)

## What is built right now (Phase 1)
- Connects to your WhatsApp via QR code
- Listens to NEW incoming messages
- Remembers chat history per person (SQLite)
- Uses Gemini (free) to write a reply in your tone
- Adds a random delay + "typing..." indicator before sending

## What is NOT built yet (Phase 2 — next step)
- Replying to OLD unread messages that arrived before the bot started
  (your "backlog" request). This needs WhatsApp's history-sync feature,
  which is more advanced and less stable across Baileys versions.
  We will add this once Phase 1 is tested and working.

I'm telling you this clearly so you know exactly what to expect —
no guessing, no overpromising.

---

## Step 1 — Install Node.js on Arch Linux

```bash
sudo pacman -S nodejs npm
node -v   # should show v18 or higher
```

## Step 2 — Get your free Gemini API key
1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account
3. Click "Create API Key" — it's free, no credit card needed
4. Copy the key

## Step 3 — Set up the project
```bash
cd whatsapp-bot
npm install
cp .env.example .env
```
Now open `.env` in any editor (e.g. `nano .env` or your Neovim setup) and paste your Gemini key:
```
GEMINI_API_KEY=paste_your_key_here
```

## Step 4 — Run the bot for the first time
```bash
npm start
```
A QR code will appear in your terminal.
Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device** → scan it.

⚠️ **Use a spare number if possible** (see the ban-risk warning from earlier). If you only have your main number, that's your choice — just know the risk.

## Step 5 — Test it
Ask a friend (or use a second phone/WhatsApp Web) to message the connected number. Watch your terminal — you should see:
```
📩 New message from ...
🤖 Replied to ...
```

## Step 6 — Run it in the background (so it works even when terminal is closed)

Since you're on Hyprland with systemd available, create a user service:

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/whatsapp-bot.service
```

Paste this (adjust the path to where you placed the project):

```ini
[Unit]
Description=WhatsApp Auto Reply Bot

[Service]
WorkingDirectory=/home/YOUR_USERNAME/whatsapp-bot
ExecStart=/usr/bin/node src/index.js
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable and start it:
```bash
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-bot.service
```

Check logs anytime:
```bash
journalctl --user -u whatsapp-bot.service -f
```

---

## Files in this project
- `src/index.js` — connects to WhatsApp, listens, orchestrates replies
- `src/db.js` — the bot's memory (SQLite chat history)
- `src/gemini.js` — the bot's brain (free Gemini API call)
- `.env` — your secret keys and settings (never share this file)
- `bot-memory.sqlite` — created automatically, stores your chat history

## Safety reminders
- This uses an **unofficial** WhatsApp connection method (Baileys). Ban risk is real.
- Google's Gemini free tier has rate limits (roughly 10–15 requests per minute, up to ~250–1000 per day depending on model) — plenty for personal use, but don't spam-test it too fast.
- Keep `.env` and the `auth/` folder private — they contain your login session.