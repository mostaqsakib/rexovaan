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
const HEARTBEAT_MS = Math.max(5000, parseInt(process.env.BOT_CHECKER_LOCK_HEARTBEAT_MS || '15000', 10));

let activeToken = null;
let heartbeatTimer = null;

function writeLock(token, label, startedAt) {
  fs.writeFileSync(LOCK_PATH, JSON.stringify({
    pid: process.pid,
    token,
    startedAt,
    heartbeatAt: Date.now(),
    label: String(label).slice(0, 120),
  }));
}

export function acquire(label = '') {
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();
  try {
    activeToken = token;
    writeLock(token, label, startedAt);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (!activeToken) return;
      try { writeLock(token, label, startedAt); }
      catch (e) { console.warn('priority-lock heartbeat failed:', e?.message || e); }
    }, HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  } catch (e) {
    console.warn('priority-lock acquire failed:', e?.message || e);
  }
  return token;
}

export function release(token = activeToken) {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  activeToken = null;
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const info = JSON.parse(raw);
    if (info?.token && token && info.token !== token) return;
    fs.unlinkSync(LOCK_PATH);
  }
  catch (e) { if (e?.code !== 'ENOENT') console.warn('priority-lock release failed:', e?.message || e); }
}
