// Journalisation simple au format JSON (une ligne par événement) dans data/journal-AAAA-MM.log
// + console. Les journaux ne contiennent jamais de clés API.
const fs = require('fs');
const path = require('path');
const config = require('../config');

function write(level, agent, message, extra = {}) {
  const entry = { ts: new Date().toISOString(), level, agent, message, ...extra };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line); else console.log(line);
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const file = path.join(config.dataDir, `journal-${entry.ts.slice(0, 7)}.log`);
    fs.appendFileSync(file, line + '\n');
  } catch (_) { /* la journalisation ne doit jamais faire planter un agent */ }
  return entry;
}

module.exports = {
  info: (agent, msg, extra) => write('info', agent, msg, extra),
  warn: (agent, msg, extra) => write('warn', agent, msg, extra),
  error: (agent, msg, extra) => write('error', agent, msg, extra),
};
