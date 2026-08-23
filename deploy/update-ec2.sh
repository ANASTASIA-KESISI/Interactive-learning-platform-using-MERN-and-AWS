#!/usr/bin/env bash
# Fast update path for an ALREADY-provisioned instance — the per-deploy
# counterpart to setup-ec2.sh (which provisions a fresh box and pulls in
# system packages).
#
# Invoked by CI (.github/workflows/ci.yml, job deploy-api) through SSM
# Run Command AFTER the working tree has been reset to the commit that
# passed lint + test. Also safe to run by hand from a Session Manager
# shell:
#
#   sudo bash /opt/learncode/deploy/update-ec2.sh
#
# Assumes: the tree at /opt/learncode is already at the desired commit,
# Node/nginx/systemd are installed, and /etc/learncode/secrets.env exists.
# The unit file and nginx site in deploy/ carry their real production
# values (CLIENT_ORIGIN, server_name), so re-copying them here is safe.

set -euo pipefail

APP_DIR=/opt/learncode
SERVICE_USER=learncode

# SSM Run Command executes as root; a manual Session Manager shell does not.
if [[ $EUID -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi

echo "==> Deploying $(git -C "$APP_DIR" rev-parse --short HEAD): $(git -C "$APP_DIR" log -1 --format=%s)"

echo "==> Installing production dependencies"
npm ci --omit=dev --prefix "$APP_DIR" --workspace server

# Records which commit is serving traffic; surfaced by GET /health. Written
# before the chown so the service account can read it. Gitignored, so a later
# `git reset --hard` leaves it alone.
printf '{"commit":"%s","deployedAt":"%s"}\n' \
  "$(git -C "$APP_DIR" rev-parse HEAD)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$APP_DIR/deploy-stamp.json"

chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> Refreshing systemd unit and nginx site"
cp "$APP_DIR/deploy/learncode-api.service" /etc/systemd/system/
cp "$APP_DIR/deploy/nginx-learncode.conf" /etc/nginx/conf.d/learncode.conf
systemctl daemon-reload

echo "==> Restarting API"
systemctl restart learncode-api

echo "==> Waiting for /health"
for _ in $(seq 1 12); do
  if curl -sf localhost:4000/health >/dev/null; then
    echo "==> API healthy"
    nginx -t
    systemctl reload nginx
    echo "==> Deploy complete"
    exit 0
  fi
  sleep 5
done

echo "ERROR: API did not become healthy within 60s; recent logs follow" >&2
journalctl -u learncode-api -n 50 --no-pager >&2
exit 1
