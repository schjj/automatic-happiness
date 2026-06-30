#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

echo "Installing ollama via https://ollama.com/install.sh ..."
curl -fsSL https://ollama.com/install.sh | sh
echo "ollama installed successfully."

echo "automatic-happiness is ready."
