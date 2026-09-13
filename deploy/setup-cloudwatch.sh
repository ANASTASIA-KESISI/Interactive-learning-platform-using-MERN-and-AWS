#!/usr/bin/env bash
# Ships the API's structured logs to CloudWatch Logs.
#
# Run once per instance from a Session Manager shell, AFTER the instance role
# (learncode-ec2-role) has the managed policy CloudWatchAgentServerPolicy:
#
#   sudo bash /opt/learncode/deploy/setup-cloudwatch.sh
#
# Idempotent — safe to re-run. Does NOT restart the API: the API keeps logging
# to the journal exactly as before, and a companion unit tails the journal into
# /var/log/learncode/api.log, which the CloudWatch agent ships to the log group
# /learncode/api. See DEPLOYMENT.md §7.
#
# What lands in the log group is one JSON object per line — request lines with
# method, path, status, durationMs and role; application events at info, warn
# and error — so Logs Insights can query fields directly.

set -euo pipefail

APP_DIR=/opt/learncode
AGENT_CTL=/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl
LOG_FILE=/var/log/learncode/api.log

if [[ $EUID -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi

for f in cloudwatch-agent.json learncode-journal-export.service logrotate-learncode; do
  if [[ ! -f "$APP_DIR/deploy/$f" ]]; then
    echo "ERROR: $APP_DIR/deploy/$f missing — is the tree at a commit that has it?" >&2
    exit 1
  fi
done

echo "==> Installing CloudWatch agent, jq and logrotate"
dnf install -y amazon-cloudwatch-agent jq logrotate

echo "==> Installing journal export unit"
# The unit declares LogsDirectory= and StateDirectory=, but systemd opens
# StandardOutput=append: BEFORE it creates those directories, so on a fresh
# host the unit dies with status 209/STDOUT before journalctl ever runs.
# Create them here; the unit's declarations then only maintain ownership.
install -d -m 0755 /var/log/learncode
install -d -m 0700 /var/lib/learncode-journal
cp "$APP_DIR/deploy/learncode-journal-export.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now learncode-journal-export
# `enable --now` is a no-op for an already-running unit; pick up a changed file.
systemctl restart learncode-journal-export
sleep 2
if ! systemctl is-active --quiet learncode-journal-export; then
  echo "ERROR: learncode-journal-export is not running:" >&2
  systemctl status learncode-journal-export --no-pager -l | head -12 >&2
  exit 1
fi

echo "==> Installing log rotation"
cp "$APP_DIR/deploy/logrotate-learncode" /etc/logrotate.d/learncode

echo "==> Starting CloudWatch agent with $APP_DIR/deploy/cloudwatch-agent.json"
# fetch-config with -s writes the config into the agent's own etc/ directory and
# (re)starts the agent, so the file in the repo is the only copy to edit.
"$AGENT_CTL" -a fetch-config -m ec2 -s -c "file:$APP_DIR/deploy/cloudwatch-agent.json"

# One request so there is at least one line to see land, both here and in AWS.
curl -sf localhost:4000/health >/dev/null || true
sleep 2

echo
echo "==> Journal export: $(systemctl is-active learncode-journal-export)"
echo "==> Agent:          $("$AGENT_CTL" -a status -m ec2 | jq -r '.status' 2>/dev/null || echo unknown)"
echo "==> Last line in $LOG_FILE:"
tail -n 1 "$LOG_FILE" 2>/dev/null || echo "(empty so far — the export starts from the current journal position)"

cat <<'NEXT'

==> Done on the host. Verify in AWS (allow a minute for the first batch):

  CloudWatch -> Log groups -> /learncode/api -> stream <instance id>

  Logs Insights, log group /learncode/api:

    fields @timestamp, method, path, status, durationMs
    | filter message = "request"
    | sort @timestamp desc
    | limit 20

  If the group never appears, check for AccessDenied in
    /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log
  — that means CloudWatchAgentServerPolicy is not on the instance role.

NEXT
