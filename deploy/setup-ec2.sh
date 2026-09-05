#!/usr/bin/env bash
# Provisions a fresh Amazon Linux 2023 instance to run the LearnCode API.
#
# Run as ec2-user AFTER the instance has an IAM role attached:
#   curl -o setup-ec2.sh https://raw.githubusercontent.com/<owner>/<repo>/dev/deploy/setup-ec2.sh
#   bash setup-ec2.sh <git-clone-url>
#
# Idempotent — safe to re-run. It stops short of starting the service, because
# the secrets file and CLIENT_ORIGIN must be filled in first; it prints the
# remaining steps at the end.

set -euo pipefail

REPO_URL="${1:-}"
# The application lives on `dev`; `main` holds only scaffolding docs, and it is
# the repository's default branch — so a plain `git clone` checks out a tree
# with no package.json and the dependency install fails with ENOENT.
BRANCH="${2:-dev}"
APP_DIR=/opt/learncode
SERVICE_USER=learncode

if [[ -z "$REPO_URL" ]]; then
  echo "usage: bash setup-ec2.sh <git-clone-url> [branch]   # branch defaults to dev" >&2
  exit 1
fi

echo "==> Updating base packages"
sudo dnf update -y

echo "==> Installing Node.js 20, git, nginx"
sudo dnf install -y nodejs20 nodejs20-npm git nginx
# AL2023 installs the binary as node-20; expose it as `node` for the unit file.
if [[ ! -e /usr/bin/node ]]; then
  sudo alternatives --install /usr/bin/node node /usr/bin/node-20 90 || true
fi
node --version

echo "==> Creating service account ${SERVICE_USER}"
if ! id "$SERVICE_USER" &>/dev/null; then
  sudo useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$SERVICE_USER"
fi

echo "==> Fetching application (${BRANCH}) to ${APP_DIR}"
# The tree is chowned to the service account below, but git runs here as root.
# Without this exception git refuses every later fetch with "dubious ownership",
# which breaks the re-run path this script relies on for updates.
sudo git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [[ -d "$APP_DIR/.git" ]]; then
  sudo git -C "$APP_DIR" fetch --all
  sudo git -C "$APP_DIR" checkout "$BRANCH"
  sudo git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
else
  sudo mkdir -p "$APP_DIR"
  sudo git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "ERROR: no package.json at ${APP_DIR} — wrong branch checked out?" >&2
  exit 1
fi

echo "==> Installing production dependencies"
# --omit=dev skips jest/eslint/nodemon; the workspace root drives both packages.
sudo npm ci --omit=dev --prefix "$APP_DIR" --workspace server

sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> Installing systemd unit"
sudo cp "$APP_DIR/deploy/learncode-api.service" /etc/systemd/system/
sudo systemctl daemon-reload

echo "==> Installing nginx site"
sudo cp "$APP_DIR/deploy/nginx-learncode.conf" /etc/nginx/conf.d/learncode.conf
sudo systemctl enable --now nginx

cat <<'NEXT'

==> Provisioning complete. Remaining manual steps:

  1. Create the secrets file (neither value is stored in the repo):

       sudo mkdir -p /etc/learncode
       sudo tee /etc/learncode/secrets.env >/dev/null <<'EOF'
       MONGODB_URI=mongodb+srv://USER:PASS@host/learncode?retryWrites=true&w=majority
       INSTRUCTOR_INVITE_CODE=REPLACE_WITH_A_LONG_RANDOM_VALUE
       EOF
       sudo chmod 600 /etc/learncode/secrets.env

     INSTRUCTOR_INVITE_CODE is the code teaching staff enter at /signup/instructor
     to claim the instructor role. Omitting it is safe but fails quietly: the
     endpoint answers 503 and instructor signup creates an ordinary student
     account instead. Generate a value with:

       node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

  2. CLIENT_ORIGIN in the systemd unit and server_name in the nginx site are
     pre-filled with this account's production values. If deploying elsewhere,
     change them IN THE REPO (CI re-copies both files on every deploy, so
     host-side edits do not survive). Then:

       sudo systemctl daemon-reload
       sudo nginx -t && sudo systemctl reload nginx

  3. Allow this instance's Elastic IP in MongoDB Atlas -> Network Access.

  4. Start the API and verify:

       sudo systemctl enable --now learncode-api
       curl -s localhost:4000/health
       journalctl -u learncode-api -n 30 --no-pager

     A boot failure mentioning CODE_RUNNER_ADAPTER means the unit file did not
     apply — that guard exists to stop untrusted code running in this process.

NEXT
