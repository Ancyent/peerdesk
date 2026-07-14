# Linux agent — connection troubleshooting

Use this when a Linux (headless) agent is **online** in the dashboard but the web
viewer rejects the connection with **"Wrong ID or password"** even though you set
a known password.

## Root cause (fixed in v0.4.31, but old installs may still be affected)

The agent stores its config at `$HOME/.config/peerdesk/config.json`. Before
v0.4.31 the generated systemd unit set no `HOME`, so the **service** and the
**interactive commands** (`install`, `--reset-password`) resolved to *different*
files. A password set/reset then never reached the running service. v0.4.31 pins
`Environment=HOME=/root` in the unit and makes reinstall `restart` the service —
but a box that was first installed with an older agent can still have a stale
config at a second path (e.g. `/config.json` or `/.config/peerdesk/config.json`).

## Step 1 — gather the current state (paste the full output)

```bash
echo "=== ENV of the running process ==="
sudo tr '\0' '\n' < /proc/$(pgrep -f 'peerdesk-agent --silent' | head -1)/environ | grep -E 'HOME|XDG|PWD'
echo "=== systemd unit ==="
cat /etc/systemd/system/peerdesk-agent.service
echo "=== every peerdesk config on disk ==="
sudo find / -name config.json -path '*peerdesk*' 2>/dev/null -exec sh -c 'echo "FILE: $1"; cat "$1"; echo' _ {} \;
```

What it reveals: the service's real `HOME`, whether the unit has `HOME=/root`,
and **all** config files with their `peer_id` + `password_hash`. If more than one
config file exists, the service is reading the one the server's stored hash
matches — and your reset/reinstall wrote to a different one.

## Step 2 — clean reinstall (deterministic fix)

Wipes every stale config so exactly one remains, then reinstalls with your
chosen password and restarts the service so it picks up the new unit + config.
Generate a fresh registration token in the dashboard first.

```bash
# 1. stop and fully remove the old agent (service + binary + ALL configs)
sudo systemctl stop peerdesk-agent 2>/dev/null
sudo pkill -f peerdesk-agent 2>/dev/null
sudo /usr/local/bin/peerdesk-agent --uninstall-service 2>/dev/null
sudo rm -f /usr/local/bin/peerdesk-agent
sudo find / -name config.json -path '*peerdesk*' -delete 2>/dev/null
sudo find / -name peerdesk.json -delete 2>/dev/null

# 2. reinstall with your password (replace TOKEN and the password)
curl -sSL http://192.168.200.223/install.sh | sudo bash -s -- \
  --server=http://192.168.200.223 --api-key=TOKEN --password='YourPassword'

# 3. make sure the running service uses the new unit + config
sudo systemctl restart peerdesk-agent
```

A **new device** (new peer ID) appears in the dashboard; the old one goes
offline. Connect to the new one with `YourPassword` and tick "save password".

## Step 3 — verify the password took (optional, run on the SERVER host)

On the machine running the PeerDesk server (`192.168.200.223`):

```bash
cd deploy
# stored hash the agent announced:
docker compose exec redis redis-cli HGET agent:<PEER_ID> password_hash
```

The stored `$2b$...` hash should change every time you set a new password. If it
never changes across resets, the service is still reading a stale config → repeat
Step 2 and confirm Step 1 shows only one config file.
