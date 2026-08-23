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

# SSM Run Command supplies no HOME. Without it git refuses to read its global
# config ("fatal: $HOME not set") and npm cannot place its cache, so both the
# stamp below and the install fail. Harmless when HOME is already set.
export HOME="${HOME:-/root}"

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

# Validate the nginx site the moment it lands, and put the old one back if it
# does not pass. An invalid file left on disk is worse than a failed deploy:
# the running nginx keeps serving from memory and looks fine, then fails to
# start on the next reboot, turning a bad config into a delayed outage.
NGINX_SITE=/etc/nginx/conf.d/learncode.conf
NGINX_BACKUP=""
if [[ -f "$NGINX_SITE" ]]; then
  NGINX_BACKUP=$(mktemp)
  cp "$NGINX_SITE" "$NGINX_BACKUP"
fi
cp "$APP_DIR/deploy/nginx-learncode.conf" "$NGINX_SITE"
if ! nginx -t; then
  if [[ -n "$NGINX_BACKUP" ]]; then
    cp "$NGINX_BACKUP" "$NGINX_SITE"
    echo "ERROR: new nginx site failed validation; previous file restored" >&2
  else
    rm -f "$NGINX_SITE"
    echo "ERROR: new nginx site failed validation; removed" >&2
  fi
  exit 1
fi
if [[ -n "$NGINX_BACKUP" ]]; then
  rm -f "$NGINX_BACKUP"
fi

systemctl daemon-reload

echo "==> Restarting API"
systemctl restart learncode-api

# src/server.js awaits the Mongo connection BEFORE app.listen(), so port 4000
# stays shut for the whole Atlas handshake and "not listening yet" is normal
# for the first few seconds. Observed ~5s; the headroom is for a slow Atlas
# day, and costs nothing on a healthy deploy since this exits on first success.
echo "==> Waiting for /health (up to 180s)"
for i in $(seq 1 36); do
  if curl -sf localhost:4000/health >/dev/null; then
    echo "==> API healthy after ~$(( (i - 1) * 5 ))s"
    # Already validated above, so this cannot fail the deploy after the fact.
    systemctl reload nginx
    echo "==> Deploy complete"
    exit 0
  fi

  # A unit systemd has given up on will never become healthy; say so now
  # rather than burning the remaining wait.
  state=$(systemctl is-active learncode-api || true)
  if [[ "$state" == "failed" || "$state" == "inactive" ]]; then
    echo "ERROR: learncode-api is ${state}; recent logs follow" >&2
    journalctl -u learncode-api -n 50 --no-pager >&2
    exit 1
  fi

  sleep 5
done

echo "ERROR: API did not answer /health within 180s; recent logs follow" >&2
journalctl -u learncode-api -n 50 --no-pager >&2
exit 1
