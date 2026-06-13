// Downloads + extracts the Google Chromium profile zip on boot.
// Supports direct URLs and gofile.io share links.
// Skips if PROFILE_DIR already contains a "Default" subfolder.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PROFILE_DIR = process.env.PROFILE_DIR || '/data/google-profile';
const PROFILE_ZIP_URL = process.env.PROFILE_ZIP_URL;

async function resolveGofile(shareUrl) {
  // shareUrl like https://gofile.io/d/uy0ubZ  → contentId = uy0ubZ
  const m = shareUrl.match(/gofile\.io\/d\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Bad gofile URL');
  const contentId = m[1];

  // 1. create guest account → token
  const accRes = await fetch('https://api.gofile.io/accounts', { method: 'POST' });
  const accJson = await accRes.json();
  const token = accJson?.data?.token;
  if (!token) throw new Error('gofile: no guest token');

  // 2. list contents
  const listRes = await fetch(`https://api.gofile.io/contents/${contentId}?wt=4fd6sg89d7s6`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listJson = await listRes.json();
  const children = listJson?.data?.children || {};
  const first = Object.values(children).find(c => c.link || c.downloadLink);
  if (!first) throw new Error('gofile: no downloadable child found');
  return { url: first.link || first.downloadLink, token };
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
  if (fs.existsSync(path.join(PROFILE_DIR, 'Default'))) {
    console.log('[setup-profile] profile already present at', PROFILE_DIR, '— skipping');
    return;
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
