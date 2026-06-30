#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

echo "Installing ollama..."
curl -fsSL https://ollama.com/install.sh | sh

echo "automatic-happiness is ready."
