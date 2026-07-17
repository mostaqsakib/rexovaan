// Shared priority lock so the site's VPS link-checker pauses while the
// Telegram bot's checker is running. Both processes live on the same VPS
// and coordinate through a single lock file on disk.
//
// Bot side (this file): acquire() writes {pid, startedAt} JSON to the
// lock path. release() removes it. If the bot crashes, the file may be
// left behind — site worker treats it as stale after STALE_MS.
//
// Site side (vps-worker/priority-lock.js): waitUntilFree() polls this
// file and sleeps while the bot is active.

import fs from 'node:fs';

export const LOCK_PATH = process.env.BOT_CHECKER_LOCK_PATH || '/tmp/rexovaan-bot-checker.lock';
export const STALE_MS = parseInt(process.env.BOT_CHECKER_LOCK_STALE_MS || '1800000', 10); // 30 min

export function acquire(label = '') {
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({
      pid: process.pid,
      startedAt: Date.now(),
      label: String(label).slice(0, 120),
    }));
  } catch (e) {
    console.warn('priority-lock acquire failed:', e?.message || e);
  }
}

export function release() {
  try { fs.unlinkSync(LOCK_PATH); }
  catch (e) { if (e?.code !== 'ENOENT') console.warn('priority-lock release failed:', e?.message || e); }
}
