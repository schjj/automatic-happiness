#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

echo "Installing ollama via https://ollama.com/install.sh ..."
curl -fsSL https://ollama.com/install.sh | sh
echo "ollama installed successfully."

echo "Starting ollama service..."
if ! pgrep -x ollama &>/dev/null; then
  ollama serve &>/dev/null &
fi
echo "Waiting for ollama to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:11434 &>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: ollama service did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

echo "Pulling llama3.1 (offline ChatGPT-equivalent model)..."
ollama pull llama3.1
echo "llama3.1 pulled successfully."

echo "Pulling hermes3 (NousResearch Hermes 3 agentic model)..."
ollama pull hermes3
echo "hermes3 pulled successfully."

echo "Installing Open WebUI (AI agent) via Docker..."
if ! command -v docker &>/dev/null; then
  echo "Error: Docker is not installed or not in PATH. Please install Docker first." >&2
  exit 1
fi
if docker ps -a --format '{{.Names}}' | grep -q '^open-webui$'; then
  echo "open-webui container already exists — skipping creation."
  docker start open-webui 2>/dev/null || true
else
  docker run -d \
    --name open-webui \
    --restart always \
    --network host \
    -v open-webui:/app/backend/data \
    -e OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    ghcr.io/open-webui/open-webui:main
fi
echo "Open WebUI is running at http://localhost:8080"

# ── SearXNG ──────────────────────────────────────────────────────────────────
echo "Installing SearXNG (self-hosted private search engine)..."
if docker ps -a --format '{{.Names}}' | grep -q '^searxng$'; then
  echo "searxng container already exists — skipping creation."
  docker start searxng 2>/dev/null || true
else
  docker run -d \
    --name searxng \
    --restart always \
    -p 8888:8080 \
    -v searxng:/etc/searxng \
    -e SEARXNG_BASE_URL=http://localhost:8888 \
    searxng/searxng:latest
fi
echo "SearXNG is running at http://localhost:8888"

# ── Open Interpreter ─────────────────────────────────────────────────────────
echo "Installing Open Interpreter (AI code execution agent)..."
if ! command -v pip3 &>/dev/null; then
  echo "Error: pip3 is not installed. Please install Python 3 with pip." >&2
  exit 1
fi
pip3 install --upgrade open-interpreter
echo "Open Interpreter installed. Run: interpreter"

# ── n8n ───────────────────────────────────────────────────────────────────────
echo "Installing n8n (visual workflow automation with AI/LLM nodes)..."
if docker ps -a --format '{{.Names}}' | grep -q '^n8n$'; then
  echo "n8n container already exists — skipping creation."
  docker start n8n 2>/dev/null || true
else
  docker run -d \
    --name n8n \
    --restart always \
    -p 5678:5678 \
    -v n8n_data:/home/node/.n8n \
    n8nio/n8n:latest
fi
echo "n8n is running at http://localhost:5678"

echo "automatic-happiness is ready."
