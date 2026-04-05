FROM ollama/ollama:latest

# install curl for entrypoint warmup
USER root
RUN apt-get update && apt-get install --yes --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
