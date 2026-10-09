const fs = require('fs');
const path = require('path');
const { isDBConnected, AuditLog } = require('./db');

const LOG_FILE = path.join(__dirname, 'audit-log.json');

async function logEvent(event) {
  const entry = {
    timestamp: new Date(),
    ...event,
  };

  // 1. MongoDB persistence (if connected)
  if (isDBConnected()) {
    try {
      await AuditLog.create(entry);
    } catch (err) {
      console.error('[AuditLog DB Write Error]:', err.message);
    }
  }

  // 2. File fallback logging
  try {
    let log = [];
    if (fs.existsSync(LOG_FILE)) {
      try {
        log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      } catch {
        log = [];
      }
    }
    log.push({ ...entry, timestamp: entry.timestamp.toISOString() });
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  } catch (fileErr) {
    console.error('[AuditLog File Write Error]:', fileErr.message);
  }
}

async function getLog() {
  if (isDBConnected()) {
    try {
      const dbLogs = await AuditLog.find().sort({ timestamp: -1 }).lean();
      if (dbLogs && dbLogs.length > 0) {
        return dbLogs;
      }
    } catch (err) {
      console.error('[AuditLog DB Read Error]:', err.message);
    }
  }

  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

module.exports = { logEvent, getLog };