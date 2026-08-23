const fs = require('fs');
const path = require('path');

// Written by deploy/update-ec2.sh on every deploy, at the repo root. Absent in
// development, CI and tests, where every field stays null rather than throwing.
const STAMP_PATH = path.join(__dirname, '..', '..', '..', 'deploy-stamp.json');

// Read once at boot: the file cannot change without the process restarting,
// since the deploy that rewrites it also restarts the service.
function readStamp() {
  try {
    const { commit, deployedAt } = JSON.parse(fs.readFileSync(STAMP_PATH, 'utf8'));
    return { commit: commit || null, deployedAt: deployedAt || null };
  } catch {
    return { commit: null, deployedAt: null };
  }
}

module.exports = readStamp();
