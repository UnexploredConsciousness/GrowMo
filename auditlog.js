const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'audit-log.json');

function logEvent(event) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };

  let log = [];
  if (fs.existsSync(LOG_FILE)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch {
      log = [];
    }
  }

  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function getLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

module.exports = { logEvent, getLog };