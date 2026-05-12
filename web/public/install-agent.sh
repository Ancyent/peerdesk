#!/bin/sh
# PeerDesk Agent Installer
# Usage: curl -fsSL https://your-server/install-agent.sh | PEERDESK_TOKEN=XXXX-XXXX PEERDESK_SERVER=wss://your-server/ws bash
set -e

[ -z "$PEERDESK_TOKEN" ]  && echo "Error: PEERDESK_TOKEN required" >&2 && exit 1
[ -z "$PEERDESK_SERVER" ] && echo "Error: PEERDESK_SERVER required" >&2 && exit 1

OS=$(uname -s); ARCH=$(uname -m)
RELEASES="https://github.com/Ancyent/peerdesk/releases/latest/download"

echo "PeerDesk Agent Installer — Token: $PEERDESK_TOKEN | OS: $OS/$ARCH"

if [ "$OS" = "Linux" ] && [ "$ARCH" = "x86_64" ]; then
  URL="$RELEASES/peerdesk-agent-linux-x86_64"
else
  echo "Unsupported: $OS/$ARCH. Download manually from https://github.com/Ancyent/peerdesk/releases" >&2
  exit 1
fi

curl -fsSL "$URL" -o /tmp/peerdesk-agent && chmod +x /tmp/peerdesk-agent
sudo mv /tmp/peerdesk-agent /usr/local/bin/peerdesk-agent

sudo tee /etc/systemd/system/peerdesk-agent.service > /dev/null << EOF
[Unit]
Description=PeerDesk Agent
After=network.target
[Service]
ExecStart=/usr/local/bin/peerdesk-agent
Environment=PEERDESK_SERVER=$PEERDESK_SERVER
Environment=PEERDESK_TOKEN=$PEERDESK_TOKEN
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now peerdesk-agent
echo "Done! Check: systemctl status peerdesk-agent"
