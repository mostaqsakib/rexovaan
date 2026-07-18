// Site-side half of the shared priority lock. See tg-link-checker/priority-lock.js.
// While the Telegram bot's checker is running, the site worker pauses between
// URL claims so both don't hammer network/CPU at once.

import fs from 'node:fs';

const LOCK_PATH = process.env.BOT_CHECKER_LOCK_PATH || '/tmp/rexovaan-bot-checker.lock';
const STALE_MS = parseInt(process.env.BOT_CHECKER_LOCK_STALE_MS || '1800000', 10); // 30 min
const POLL_MS = parseInt(process.env.BOT_CHECKER_LOCK_POLL_MS || '1000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns true if the bot is currently holding the lock (fresh, non-stale).
export function isBotBusy() {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const info = JSON.parse(raw);
    const lastSeen = Number(info?.heartbeatAt || info?.updatedAt || info?.startedAt || 0);
    const age = Date.now() - lastSeen;
    if (age > STALE_MS) {
      // Stale — bot likely crashed. Remove so we stop waiting.
      try { fs.unlinkSync(LOCK_PATH); } catch {}
      return false;
    }
    return true;
  } catch (e) {
    if (e?.code === 'ENOENT') return false;
    // Malformed lock — treat as absent.
    try { fs.unlinkSync(LOCK_PATH); } catch {}
    return false;
  }
}

// Blocks until the bot releases the lock. Logs once at the start of each wait.
export async function waitUntilFree() {
  if (!isBotBusy()) return;
  console.log('⏸️  Bot checker is running — pausing site worker...');
  while (isBotBusy()) await sleep(POLL_MS);
  console.log('▶️  Bot checker done — resuming site worker.');
}
