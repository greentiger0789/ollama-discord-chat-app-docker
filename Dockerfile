FROM ollama/ollama:latest

# install curl for entrypoint warmup
USER root
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
