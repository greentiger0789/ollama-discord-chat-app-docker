# Discord → Ollama Bot

Simple Discord bot that forwards `/o` prompts to a local Ollama HTTP API and returns answers in a thread. It also continues conversation inside the thread.

Environment variables (use `.env` or Docker env):
- `DISCORD_TOKEN` (required)
- `DISCORD_GUILD_ID` (optional, recommended for testing)
- `OLLAMA_BASE_URL` (defaults to `http://ollama:11434` inside compose)
- `OLLAMA_MODEL` (optional, default `qwen3.5`)

Build & run with docker-compose (from repo root):

```bash
docker compose up -d --build discord-bot
```

Notes:
- The implementation posts to `POST /api/generate` on the Ollama service. Adjust `src/ollamaClient.js` if your Ollama instance exposes a different endpoint or requires a different request shape.
