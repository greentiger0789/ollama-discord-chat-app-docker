#!/bin/sh
set -e

# Start ollama server in background
echo "Starting Ollama server..."
ollama serve &
SERVER_PID=$!

# Wait for server to be ready
sleep 5

# If auto-load is enabled, load the model
if [ "$OLLAMA_AUTO_LOAD" = "true" ] && [ -n "$OLLAMA_MODEL" ]; then
  echo "Auto-loading model: $OLLAMA_MODEL"
  ollama pull "$OLLAMA_MODEL"

  echo "Warming up model (loading into memory)..."
  # Send a simple request to load the model into memory
  curl -s -X POST http://localhost:11434/api/generate \
    -H "Content-Type: application/json" \
    -d "{\"model\": \"$OLLAMA_MODEL\", \"prompt\": \".\", \"stream\": false}" > /dev/null
  echo "✓ Model ready in memory: $OLLAMA_MODEL"
fi

echo "Ollama is ready for requests."

# Keep container running
wait $SERVER_PID
