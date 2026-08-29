[日本語](README.md) | English

# Discord Ollama Bot

A Discord bot powered by Ollama. It provides Q&A, web search, and per-thread conversation history management through the "Maid-chan" character.

## Features

- **Ollama integration**: Leverages local LLMs (NVIDIA GPU support) as well as cloud models
- **Slash command**: Ask with the `/o` command and the bot replies in a created thread
- **Conversation history**: Keeps history per thread and automatically summarizes it when it grows long
- **Abort and regenerate**: The requester can use ❌ / 🔄 on an in-progress or most recent response
- **Multi-user conversations**: Distinguishes participants and prioritizes the most recent speaker
- **Web search**: Real-time search via Tavily (falls back to DuckDuckGo on failure)
- **Hot-reload development**: Automatically restarts on changes to source, config, or `.env`
- **Open WebUI**: Optional web UI

## Prerequisites

- Docker / Docker Compose v2 or later
- NVIDIA GPU (configured automatically in the container; on GPU-less environments adjust `deploy.resources` in `docker-compose.yml`)
- Discord bot token (create one at the [Discord Developer Portal](https://discord.com/developers/applications))
- For web search: a [Tavily](https://tavily.com/) API key

Runtime: Node.js v26+ (only if running directly)

## Quick Start

### 1. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` to set `DISCORD_TOKEN` and other values.

### 2. Start

```bash
make up
```

### 3. Verify

Run the `/o` command in Discord. If the bot creates a thread and replies, you are all set.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `DISCORD_GUILD_ID` | ❌ | Server ID to register commands (global commands if unset) |
| `OLLAMA_HOST` | ❌ | Listen URL of the Ollama server itself (default: `http://0.0.0.0:11434`) |
| `OLLAMA_BASE_URL` | ❌ | Ollama server URL as seen from the bot (default: `http://ollama:11434`) |
| `OLLAMA_MODEL` | ❌ | Model name to use (default: `qwen3.5:9b`) |
| `OLLAMA_AUTO_LOAD` | ❌ | When `true`, pulls and warms up the model at startup (warmup is skipped for cloud models) |
| `TAVILY_API_KEY` | ❌ | API key for web search |
| `LOG_LEVEL` | ❌ | `debug` / `info` / `warn` / `error` / `silent` (default: `info`) |
| `COMPOSE_PROFILES` | ❌ | Set to `webui` to enable Open WebUI |

## Usage

### `/o` command

- Send a prompt via the required `prompt` option; the bot creates a thread and replies
- Optionally attach a text file with `file` to include its contents in the answer (up to 512KB and 20,000 characters)
- Follow-up messages inside the thread keep the conversation context
- Messages that directly mention another human member, or reply to that member, are ignored and excluded from conversation history. This applies regardless of the “notify replied user” setting and when both Maid-chan and another member are addressed
- The “thinking” and most recent response messages include ❌ (abort) and 🔄 (regenerate), available to the user who started that response
- Long responses are automatically split into 1900-character chunks

Text files, source code, and logs are supported. Images, videos, audio, PDFs, and archive files
cannot be read. When multiple files are attached in a thread, only the first one is read.
Do not attach secrets such as tokens, passwords, or `.env` files.

When multiple people speak in a thread, Discord display names are included in the Ollama input to distinguish the conversation context. User IDs are not sent.

### Open WebUI

Set `COMPOSE_PROFILES=webui` in `.env` and run `make up` to use the web UI at `http://localhost:3000`.

## Configuration Files

### `discord-bot/config/models.yml`

Defines per-model parameters (`num_ctx`, `num_predict`, `temperature`, `mirostat`, `repeat_penalty`, etc.). The bot loads model settings from this file.

```yaml
models:
  qwen3.5:9b:
    num_ctx: 16384
    num_predict: 8192
    temperature: 0.3
```

### `discord-bot/config/prompts.yml`

Defines the system prompt (the Maid-chan character settings) and notification messages shown when a web search was performed.

## Development, Testing & Lint

The Makefile is recommended (run on the host). Inside the bot container, targets automatically switch to JS-only ones.

```bash
# Start / stop
make up            # Start containers in background
make dev           # Development mode (with logs)
make down          # Stop containers
make down-v        # Stop containers and remove volumes
make shell         # Open a shell in the discord-bot container

# Test
make test          # Run tests in a fresh container
make test-quick    # Run tests in a running container (faster)

# Lint
make lint          # All linters (JS + Actions + Dockerfile)
make lint-js       # Biome lint only
make lint-actions  # actionlint only
make lint-docker   # hadolint only

# Security scans
make lint-security # Run all scans
make scan-secrets  # Gitleaks
make scan-vulns    # Trivy
make scan-code     # npm audit
```

Running commands directly:

```bash
docker compose run --build --rm --no-deps discord-bot npm test
docker compose exec discord-bot npm test   # Quick rerun in a running container
docker compose run --build --rm --no-deps discord-bot npm run lint
```

Running Node.js directly on the host:

```bash
cd discord-bot
npm ci
npm run dev    # With hot reload
npm start      # Normal run
```

## Architecture

```
Discord ──> discord-bot ──> ollama (LLM inference)
                │
                └──> Tavily / DuckDuckGo (web search)
```

Response generation flow:

1. **Token estimation**: Estimates token count from input text length (tuned for Japanese LLMs)
2. **History summarization**: Summarizes overly long history to save context (up to 12000 tokens)
3. **Search decision**: Decides whether a web search is needed via a prompt
4. **Response generation**: Sends the prompt to the LLM including search results
5. **Response splitting**: Splits responses to fit the Discord limit (1900 characters)

Key modules (`discord-bot/src/`):

| Module | Role |
|--------|------|
| `index.js` | Entry point. Initializes the client and registers handlers |
| `ollamaClient.js` | Ollama API communication, search decision, history summarization, model config loading |
| `threadManager.js` | Per-thread conversation history management |
| `messageUtils.js` | Message splitting and "thinking" message generation |
| `prompts.js` / `systemPrompt.js` / `decisionPrompt.js` | Prompt management |
| `commands/oCommand.js` | `/o` slash command handler |
| `handlers/threadMessageHandler.js` | Follow-up message handling within threads |

## Directory Structure

```
.
├── docker-compose.yml           # Service orchestration
├── Dockerfile                   # Ollama server image
├── ollama-entrypoint.sh         # Ollama startup, model pull, warmup
├── Makefile                     # Dev/lint/test commands
├── .env.example                 # Environment variable template
├── .github/workflows/           # ci.yml / gitleaks.yml / trivy.yml
└── discord-bot/                 # Discord bot itself
    ├── index.js                 # Entry point
    ├── dev-runner.js            # Hot-reload runner for development
    ├── biome.json               # Biome configuration
    ├── config/
    │   ├── models.yml           # Per-model parameters
    │   └── prompts.yml          # Prompt configuration
    ├── src/                     # Source code
    └── test/                    # Tests (node:test)
```

## CI/CD

The following workflows are configured in `.github/workflows/`.

- **`ci.yml`**: Runs `npm ci` → `npm run lint` → `npm test` on Node.js 26, plus actionlint / hadolint / Docker build checks
- **`gitleaks.yml`**: Secret scanning (posts results as PR comments)
- **`trivy.yml`**: Vulnerability scanning of images and the filesystem (HIGH/CRITICAL; results uploaded to the GitHub Security tab)

Make sure `make lint` and `make test` pass before creating a PR.

## Troubleshooting

| Symptom | Things to check |
|---------|-----------------|
| Bot does not respond | `DISCORD_TOKEN`, bot permissions (Send Messages / Read Message History / Add Reactions / Embed Links / Manage Threads), Ollama server status |
| Cannot connect to Ollama | `OLLAMA_BASE_URL`, inter-container networking, health check via `docker compose logs ollama` |
| Web search not working | `TAVILY_API_KEY`, API rate limits |

## References

- [discord.js documentation](https://discord.js.org/)
- [Ollama official](https://github.com/ollama/ollama)
- [Tavily API](https://tavily.com/)
- [Docker Compose documentation](https://docs.docker.com/compose/)

---

Contributions welcome! 🎉 Feel free to open issues or pull requests.
