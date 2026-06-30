#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

echo "Installing ollama via https://ollama.com/install.sh ..."
curl -fsSL https://ollama.com/install.sh | sh
echo "ollama installed successfully."

echo "Installing Open WebUI (AI agent) via Docker..."
docker run -d \
  --name open-webui \
  --restart always \
  --network host \
  -v open-webui:/app/backend/data \
  -e OLLAMA_BASE_URL=http://127.0.0.1:11434 \
  ghcr.io/open-webui/open-webui:main
echo "Open WebUI installed and running at http://localhost:8080"

echo "automatic-happiness is ready."
