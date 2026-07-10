#!/usr/bin/env bash

set -euo pipefail

# Several steps (ollama install, writing systemd units) require root.
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root (or with sudo)." >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

echo "Installing ollama via https://ollama.com/install.sh ..."
curl -fsSL https://ollama.com/install.sh | sh
echo "ollama installed successfully."

echo "Enabling ollama service to start on boot..."
if command -v systemctl &>/dev/null; then
  systemctl enable --now ollama
else
  # Fallback for non-systemd hosts
  if ! pgrep -x ollama &>/dev/null; then
    ollama serve &>/dev/null &
  fi
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
if command -v systemctl &>/dev/null; then
  systemctl enable docker 2>/dev/null || true
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
    -e WEBUI_AUTH=False \
    -e ENABLE_SIGNUP=False \
    -e DEFAULT_MODELS=llama3.1 \
    -e ENABLE_COMMUNITY_SHARING=False \
    -e ENABLE_MESSAGE_RATING=False \
    -e ENABLE_TELEMETRY=False \
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
# Configure Open Interpreter to use local ollama instead of OpenAI.
# Write config for the invoking user (may differ from root when using sudo).
if [ -n "${SUDO_USER:-}" ]; then
  OI_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  OI_HOME="$HOME"
fi
OI_CONFIG_DIR="$OI_HOME/.config/open-interpreter"
mkdir -p "$OI_CONFIG_DIR"
cat > "$OI_CONFIG_DIR/config.yaml" <<'EOF'
llm:
  model: ollama/llama3.1
  api_base: http://localhost:11434
  api_key: ollama
EOF
echo "Open Interpreter configured to use local ollama (llama3.1)."

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
    -e N8N_AI_ENABLED=true \
    -e N8N_AI_PROVIDER=ollama \
    -e N8N_AI_OLLAMA_BASE_URL=http://host-gateway:11434 \
    -e N8N_DIAGNOSTICS_ENABLED=false \
    -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
    -e N8N_PERSONALIZATION_ENABLED=false \
    --add-host=host-gateway:host-gateway \
    n8nio/n8n:latest
  # host-gateway resolves to the Docker host IP so the container can reach
  # the ollama service running on the host at port 11434.
fi
echo "n8n is running at http://localhost:5678"

# ── Firecrawl ─────────────────────────────────────────────────────────────────
echo "Installing Firecrawl (LLM-optimized web scraper)..."
if ! docker compose version &>/dev/null 2>&1 && ! command -v docker-compose &>/dev/null; then
  echo "Error: docker compose is not available. Please install Docker Compose." >&2
  exit 1
fi
FIRECRAWL_DIR="$repo_root/firecrawl"
if [ ! -d "$FIRECRAWL_DIR" ]; then
  git clone --depth 1 https://github.com/mendableai/firecrawl.git "$FIRECRAWL_DIR"
fi
cd "$FIRECRAWL_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
fi
if docker compose version &>/dev/null 2>&1; then
  docker compose up -d
else
  docker-compose up -d
fi
cd "$repo_root"
echo "Firecrawl API is running at http://localhost:3002"
if command -v systemctl &>/dev/null; then
  cat > /etc/systemd/system/firecrawl.service <<EOF
[Unit]
Description=Firecrawl LLM web scraper
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$FIRECRAWL_DIR
ExecStart=docker compose up -d
ExecStop=docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable firecrawl
  echo "Firecrawl systemd service enabled (auto-starts on boot)."
fi

# ── HexStrike AI ──────────────────────────────────────────────────────────────
echo "Installing HexStrike AI (cybersecurity multi-agent framework)..."
HEXSTRIKE_DIR="$repo_root/hexstrike-ai"
if [ ! -d "$HEXSTRIKE_DIR" ]; then
  git clone --depth 1 https://github.com/0x4m4/hexstrike-ai.git "$HEXSTRIKE_DIR"
fi
cd "$HEXSTRIKE_DIR"
python3 -m venv hexstrike_env
if [ ! -f hexstrike_env/bin/activate ]; then
  echo "Error: Python venv creation failed for HexStrike AI." >&2
  exit 1
fi
# shellcheck disable=SC1091
source hexstrike_env/bin/activate
if [ ! -f requirements.txt ]; then
  echo "Error: requirements.txt not found in HexStrike AI repository." >&2
  deactivate
  exit 1
fi
pip3 install --upgrade -r requirements.txt
deactivate
cd "$repo_root"
echo "HexStrike AI installed. To run: cd hexstrike-ai && source hexstrike_env/bin/activate && python3 hexstrike_server.py"
if command -v systemctl &>/dev/null; then
  cat > /etc/systemd/system/hexstrike-ai.service <<EOF
[Unit]
Description=HexStrike AI cybersecurity multi-agent server
After=ollama.service

[Service]
Type=simple
WorkingDirectory=$HEXSTRIKE_DIR
ExecStart=$HEXSTRIKE_DIR/hexstrike_env/bin/python3 $HEXSTRIKE_DIR/hexstrike_server.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable hexstrike-ai
  echo "HexStrike AI systemd service enabled (auto-starts on boot)."
fi

# ── Wazuh SIEM ───────────────────────────────────────────────────────────────
echo "Installing Wazuh SIEM (open-source security information and event management)..."
WAZUH_DIR="$repo_root/wazuh-docker"
if [ ! -d "$WAZUH_DIR" ]; then
  git clone --depth 1 --branch v4.12.0 https://github.com/wazuh/wazuh-docker.git "$WAZUH_DIR"
fi
cd "$WAZUH_DIR/single-node"
if docker compose version &>/dev/null 2>&1; then
  docker compose -f generate-indexer-certs.yml run --rm generator
  docker compose up -d
else
  docker-compose -f generate-indexer-certs.yml run --rm generator
  docker-compose up -d
fi
cd "$repo_root"
echo "Wazuh SIEM is running — dashboard at https://localhost:443"
echo "  Default credentials: admin / SecretPassword"
echo "  IMPORTANT: Change the default password immediately after first login."
if command -v systemctl &>/dev/null; then
  cat > /etc/systemd/system/wazuh-siem.service <<EOF
[Unit]
Description=Wazuh SIEM single-node stack
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$WAZUH_DIR/single-node
ExecStart=docker compose up -d
ExecStop=docker compose down
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable wazuh-siem
  echo "Wazuh SIEM systemd service enabled (auto-starts on boot)."
fi

# ── Sentinel OSINT ────────────────────────────────────────────────────────────
echo "Installing Sentinel OSINT (tactical intelligence dashboard)..."
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
  echo "Error: Node.js and npm are required for Sentinel OSINT. Please install Node.js first." >&2
  exit 1
fi
SENTINEL_OSINT_DIR="$repo_root/sentinel-osint"
if [ ! -d "$SENTINEL_OSINT_DIR" ]; then
  git clone --depth 1 https://github.com/hasanerman/sentinel-osint.git "$SENTINEL_OSINT_DIR"
fi
cd "$SENTINEL_OSINT_DIR/backend"
npm install
cd "$SENTINEL_OSINT_DIR/frontend"
npm install
npm run build
cd "$repo_root"
if command -v systemctl &>/dev/null; then
  node_bin="$(command -v node)"
  cat > /etc/systemd/system/sentinel-osint-backend.service <<EOF
[Unit]
Description=Sentinel OSINT backend API server
After=network.target

[Service]
Type=simple
WorkingDirectory=$SENTINEL_OSINT_DIR/backend
ExecStart=$node_bin server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  cat > /etc/systemd/system/sentinel-osint-frontend.service <<EOF
[Unit]
Description=Sentinel OSINT frontend (Vite preview)
After=sentinel-osint-backend.service

[Service]
Type=simple
WorkingDirectory=$SENTINEL_OSINT_DIR/frontend
ExecStart=$SENTINEL_OSINT_DIR/frontend/node_modules/.bin/vite preview --host 127.0.0.1 --port 5173
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable sentinel-osint-backend sentinel-osint-frontend
  systemctl start sentinel-osint-backend sentinel-osint-frontend
  echo "Sentinel OSINT systemd services enabled and started."
fi
echo "Sentinel OSINT API:       http://localhost:5000"
echo "Sentinel OSINT Dashboard: http://localhost:5173"

# ── OSINT Octopus ─────────────────────────────────────────────────────────────
echo "Installing OSINT Octopus (multi-tool OSINT aggregator)..."
OSINT_OCTOPUS_DIR="$repo_root/osint-octopus"
if [ ! -d "$OSINT_OCTOPUS_DIR" ]; then
  git clone --depth 1 https://github.com/Maxwell747/OSINT-OCTOPUS.git "$OSINT_OCTOPUS_DIR"
fi
cd "$OSINT_OCTOPUS_DIR"
python3 -m venv osint_octopus_env
if [ ! -f osint_octopus_env/bin/activate ]; then
  echo "Error: Python venv creation failed for OSINT Octopus." >&2
  exit 1
fi
# shellcheck disable=SC1091
source osint_octopus_env/bin/activate
pip3 install --upgrade -r requirements.txt
deactivate
if [ ! -f .env ]; then
  if [ -f env_template.txt ]; then
    cp env_template.txt .env
    echo "OSINT Octopus .env created — populate API keys in $OSINT_OCTOPUS_DIR/.env"
  else
    echo "Warning: env_template.txt not found in OSINT Octopus repo — create $OSINT_OCTOPUS_DIR/.env manually." >&2
  fi
fi
cd "$repo_root"
echo "OSINT Octopus installed."
echo "  To run: cd osint-octopus && source osint_octopus_env/bin/activate && python3 osint_octopus.py"
echo "  Populate API keys in: $OSINT_OCTOPUS_DIR/.env"

# ── Pegasus-DoxStream ─────────────────────────────────────────────────────────
echo "Installing Pegasus-DoxStream (OSINT investigation tool)..."
PEGASUS_DIR="$repo_root/pegasus-doxstream"
if [ ! -d "$PEGASUS_DIR" ]; then
  git clone --depth 1 https://github.com/sobri3195/Pegasus-DoxStream.git "$PEGASUS_DIR"
fi
cd "$PEGASUS_DIR"
python3 -m venv pegasus_env
if [ ! -f pegasus_env/bin/activate ]; then
  echo "Error: Python venv creation failed for Pegasus-DoxStream." >&2
  exit 1
fi
# shellcheck disable=SC1091
source pegasus_env/bin/activate
pip3 install --upgrade -r requirements.txt
deactivate
cd "$repo_root"
echo "Pegasus-DoxStream installed."
echo "  To run: cd pegasus-doxstream && source pegasus_env/bin/activate && streamlit run app.py"
echo "  Dashboard: http://localhost:8501"
if command -v systemctl &>/dev/null; then
  cat > /etc/systemd/system/pegasus-doxstream.service <<EOF
[Unit]
Description=Pegasus-DoxStream OSINT investigation tool
After=network.target

[Service]
Type=simple
WorkingDirectory=$PEGASUS_DIR
ExecStart=$PEGASUS_DIR/pegasus_env/bin/streamlit run app.py --server.address 127.0.0.1 --server.port 8501
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable pegasus-doxstream
  echo "Pegasus-DoxStream systemd service enabled (auto-starts on boot)."
fi

# ── Google Cloud SDK (gcloud) ─────────────────────────────────────────────────
echo "Installing Google Cloud SDK (gcloud)..."
if command -v gcloud &>/dev/null; then
  echo "gcloud is already installed — skipping."
else
  # Install via the official apt repository (Debian/Ubuntu).
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
      | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] \
https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list
    apt-get update -qq
    apt-get install -y google-cloud-cli
  else
    # Fallback: install via the interactive installer script.
    curl -fsSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
    # Add gcloud to PATH for subsequent commands in this script.
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
  fi
fi
echo "gcloud installed. Version: $(gcloud --version 2>&1 | head -1)"
echo "  Authenticate with: gcloud auth login"
echo "  Set project with:  gcloud config set project YOUR_PROJECT_ID"

# ── Tor ───────────────────────────────────────────────────────────────────────
echo "Installing Tor (anonymous overlay network for dark web access)..."
if command -v apt-get &>/dev/null; then
  apt-get install -y tor torsocks
elif command -v dnf &>/dev/null; then
  dnf install -y tor torsocks
elif command -v pacman &>/dev/null; then
  pacman -S --noconfirm tor torsocks
else
  echo "Warning: Could not detect package manager — install Tor manually." >&2
fi
if command -v systemctl &>/dev/null; then
  systemctl enable --now tor
fi
echo "Tor installed and running."
echo "  SOCKS5 proxy: 127.0.0.1:9050"
echo "  Prefix any command with 'torsocks' to route it through Tor."

# ── OnionSearch ───────────────────────────────────────────────────────────────
echo "Installing OnionSearch (dark web .onion search aggregator)..."
ONIONSEARCH_DIR="$repo_root/onionsearch"
if [ ! -d "$ONIONSEARCH_DIR" ]; then
  git clone --depth 1 https://github.com/megadose/OnionSearch.git "$ONIONSEARCH_DIR"
fi
cd "$ONIONSEARCH_DIR"
python3 -m venv onionsearch_env
if [ ! -f onionsearch_env/bin/activate ]; then
  echo "Error: Python venv creation failed for OnionSearch." >&2
  exit 1
fi
# shellcheck disable=SC1091
source onionsearch_env/bin/activate
pip3 install --upgrade -r requirements.txt 2>/dev/null || pip3 install --upgrade .
deactivate
cd "$repo_root"
echo "OnionSearch installed."
echo "  To run: cd onionsearch && source onionsearch_env/bin/activate && python3 onionsearch.py --query <term>"
echo "  NOTE: Tor must be running (port 9050) for .onion searches."

# ── theHarvester ──────────────────────────────────────────────────────────────
echo "Installing theHarvester (OSINT — emails, subdomains, hosts, IPs)..."
THEHARVESTER_DIR="$repo_root/theHarvester"
if [ ! -d "$THEHARVESTER_DIR" ]; then
  git clone --depth 1 https://github.com/laramies/theHarvester.git "$THEHARVESTER_DIR"
fi
cd "$THEHARVESTER_DIR"
python3 -m venv theharvester_env
if [ ! -f theharvester_env/bin/activate ]; then
  echo "Error: Python venv creation failed for theHarvester." >&2
  exit 1
fi
# shellcheck disable=SC1091
source theharvester_env/bin/activate
pip3 install --upgrade -r requirements/base.txt
deactivate
cd "$repo_root"
echo "theHarvester installed."
echo "  To run: cd theHarvester && source theharvester_env/bin/activate && python3 theHarvester.py -d example.com -b all"

# ── Recon-ng ──────────────────────────────────────────────────────────────────
echo "Installing Recon-ng (modular OSINT reconnaissance framework)..."
RECONNG_DIR="$repo_root/recon-ng"
if [ ! -d "$RECONNG_DIR" ]; then
  git clone --depth 1 https://github.com/lanmaster53/recon-ng.git "$RECONNG_DIR"
fi
cd "$RECONNG_DIR"
python3 -m venv reconng_env
if [ ! -f reconng_env/bin/activate ]; then
  echo "Error: Python venv creation failed for Recon-ng." >&2
  exit 1
fi
# shellcheck disable=SC1091
source reconng_env/bin/activate
pip3 install --upgrade -r REQUIREMENTS
deactivate
cd "$repo_root"
echo "Recon-ng installed."
echo "  To run: cd recon-ng && source reconng_env/bin/activate && python3 recon-ng"

# ── SpiderFoot ────────────────────────────────────────────────────────────────
echo "Installing SpiderFoot (automated OSINT collection and visualization)..."
SPIDERFOOT_DIR="$repo_root/spiderfoot"
if [ ! -d "$SPIDERFOOT_DIR" ]; then
  git clone --depth 1 https://github.com/smicallef/spiderfoot.git "$SPIDERFOOT_DIR"
fi
cd "$SPIDERFOOT_DIR"
python3 -m venv spiderfoot_env
if [ ! -f spiderfoot_env/bin/activate ]; then
  echo "Error: Python venv creation failed for SpiderFoot." >&2
  exit 1
fi
# shellcheck disable=SC1091
source spiderfoot_env/bin/activate
pip3 install --upgrade -r requirements.txt
deactivate
cd "$repo_root"
echo "SpiderFoot installed."
echo "  To run: cd spiderfoot && source spiderfoot_env/bin/activate && python3 sf.py -l 127.0.0.1:5009"
echo "  Dashboard: http://127.0.0.1:5009"
if command -v systemctl &>/dev/null; then
  cat > /etc/systemd/system/spiderfoot.service <<EOF
[Unit]
Description=SpiderFoot automated OSINT tool
After=network.target

[Service]
Type=simple
WorkingDirectory=$SPIDERFOOT_DIR
ExecStart=$SPIDERFOOT_DIR/spiderfoot_env/bin/python3 $SPIDERFOOT_DIR/sf.py -l 127.0.0.1:5009
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable spiderfoot
  echo "SpiderFoot systemd service enabled (auto-starts on boot)."
fi

# ── Shodan CLI ────────────────────────────────────────────────────────────────
echo "Installing Shodan CLI (internet-exposed device and service OSINT)..."
pip3 install --upgrade shodan
echo "Shodan CLI installed."
echo "  Initialize with your API key: shodan init YOUR_API_KEY"
echo "  Example search: shodan search 'apache country:US'"
echo "  Get a free API key at: https://account.shodan.io/"

echo "automatic-happiness is ready."
