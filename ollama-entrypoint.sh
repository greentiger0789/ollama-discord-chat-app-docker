#!/bin/sh
set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://0.0.0.0:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.5:9b}"
OLLAMA_AUTO_LOAD="${OLLAMA_AUTO_LOAD:-false}"

API_URL="$OLLAMA_HOST/api"

echo "Starting Ollama server..."

ollama serve &

SERVER_PID=$!

# =========================
# Signal handling
# =========================

trap 'echo "Stopping Ollama..."; kill $SERVER_PID; wait $SERVER_PID; exit 0' TERM INT

# =========================
# Wait for server
# =========================

wait_for_server() {

  echo "Waiting for Ollama server..."

  for i in $(seq 1 60)
  do
    if curl -s --connect-timeout 2 "$OLLAMA_HOST/api/tags" >/dev/null; then
      echo "✓ Ollama server ready"
      return 0
    fi

    sleep 1
  done

  echo "ERROR: Ollama server failed to start"
  exit 1
}

# =========================
# Pull model
# =========================

pull_model() {

  MODEL="$1"

  echo "Pulling model: $MODEL"

  if ! ollama pull "$MODEL"; then
    echo "ERROR: Failed to pull model"
    exit 1
  fi

}

# =========================
# Warmup model
# =========================

warmup_model() {

  MODEL="$1"

  # Cloud model skip
  if echo "$MODEL" | grep -q ":cloud"; then
    echo "Cloud model detected — skipping warmup"
    return 0
  fi

  echo "Warming up model: $MODEL"

  for i in 1 2 3
  do

    RESPONSE=$(curl -s \
      --connect-timeout 5 \
      --max-time 60 \
      -X POST "$OLLAMA_HOST/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$MODEL\",\"prompt\":\".\",\"stream\":false}")

    if echo "$RESPONSE" | grep -q '"error"'; then
      echo "Warmup error (attempt $i)"
      echo "$RESPONSE"
      sleep 2
      continue
    fi

    echo "✓ Model ready: $MODEL"
    return 0

  done

  echo "ERROR: Failed to warmup model"
  exit 1
}

# =========================
# Check model exists
# =========================

model_exists() {

  MODEL="$1"

  if ollama list | awk '{print $1}' | grep -q "^$MODEL$"; then
    return 0
  else
    return 1
  fi

}

# =========================
# Boot sequence
# =========================

wait_for_server

if [ "$OLLAMA_AUTO_LOAD" = "true" ] && [ -n "$OLLAMA_MODEL" ]; then

  echo "Auto load enabled"

  if model_exists "$OLLAMA_MODEL"; then
    echo "Model already exists: $OLLAMA_MODEL"
  else
    pull_model "$OLLAMA_MODEL"
  fi

  warmup_model "$OLLAMA_MODEL"

fi

echo "Ollama initialization complete"

# =========================
# Wait for server process
# =========================

wait $SERVER_PID
