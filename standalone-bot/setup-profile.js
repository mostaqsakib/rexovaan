// Downloads + extracts the Google Chromium profile zip on boot.
// Supports direct URLs and gofile.io share links.
// Skips if PROFILE_DIR already contains a "Default" subfolder.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PROFILE_DIR = process.env.PROFILE_DIR || '/data/google-profile';
const PROFILE_ZIP_URL = process.env.PROFILE_ZIP_URL;
const PROFILE_AUTH_EXPIRED_MARKER = path.join(PROFILE_DIR, '.auth-expired');

async function resolveGofile(shareUrl) {
  const m = shareUrl.match(/gofile\.io\/d\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Bad gofile URL');
  const contentId = m[1];

  const accRes = await fetch('https://api.gofile.io/accounts', { method: 'POST' });
  const accJson = await accRes.json();
  const token = accJson?.data?.token;
  if (!token) throw new Error('gofile: no guest token');

  // Try a few known website tokens — gofile rotates these.
  const wts = ['4fd6sg89d7s6', '12345', ''];
  let listJson = null;
  for (const wt of wts) {
    const url = `https://api.gofile.io/contents/${contentId}` + (wt ? `?wt=${wt}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => null);
    if (j?.status === 'ok' && j?.data?.children) { listJson = j; break; }
    console.log('[setup-profile] gofile attempt wt=' + wt + ' →', JSON.stringify(j).slice(0, 300));
  }
  if (!listJson) throw new Error('gofile: contents listing failed for all wt values');

  const children = listJson.data.children || {};
  const all = Object.values(children);
  console.log('[setup-profile] gofile children:', JSON.stringify(all).slice(0, 500));
  // Look at every possible field gofile has used over time.
  const first = all.find(c => c.link || c.downloadLink || c.directLink) || all[0];
  if (!first) throw new Error('gofile: no child found');
  const dl = first.link || first.downloadLink || first.directLink;
  if (!dl) throw new Error('gofile: child has no download link — try uploading to Supabase Storage instead and use the signed URL');
  return { url: dl, token };
}

async function downloadTo(url, headers, dest) {
  console.log('[setup-profile] downloading', url);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log('[setup-profile] saved', dest, buf.length, 'bytes');
}

async function main() {
  if (!PROFILE_ZIP_URL) {
    console.log('[setup-profile] PROFILE_ZIP_URL not set — skipping');
    return;
  }
  const hasExpiredMarker = fs.existsSync(PROFILE_AUTH_EXPIRED_MARKER);
  if (fs.existsSync(path.join(PROFILE_DIR, 'Default')) && !hasExpiredMarker) {
    console.log('[setup-profile] profile already present at', PROFILE_DIR, '— skipping');
    return;
  }
  if (hasExpiredMarker) {
    console.log('[setup-profile] expired profile marker found — replacing profile from PROFILE_ZIP_URL');
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const zipPath = '/tmp/google-profile.zip';

  let url = PROFILE_ZIP_URL;
  let headers = {};
  if (/gofile\.io\/d\//.test(url)) {
    const r = await resolveGofile(url);
    url = r.url;
    headers = { Cookie: `accountToken=${r.token}`, Authorization: `Bearer ${r.token}` };
  }

  await downloadTo(url, headers, zipPath);
  console.log('[setup-profile] extracting to', PROFILE_DIR);
  execSync(`unzip -o -q "${zipPath}" -d "${PROFILE_DIR}"`, { stdio: 'inherit' });
  fs.unlinkSync(zipPath);
  console.log('[setup-profile] done');
}

main().catch(e => {
  console.error('[setup-profile] failed:', e);
  process.exit(1);
});
