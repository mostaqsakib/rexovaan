import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PROFILE = process.env.CHROME_PROFILE_DIR || '/root/chrome-profile';
const START_URL = process.env.LOGIN_URL || 'https://accounts.google.com/';

const chromeCandidates = [
  process.env.CHROME_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const chromePath = chromeCandidates.find((path) => existsSync(path));

if (!chromePath) {
  console.error('Google Chrome/Chromium not found. Install Google Chrome first:');
  console.error('wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google-linux.gpg');
  console.error('echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list');
  console.error('apt update && apt install -y google-chrome-stable');
  process.exit(1);
}

const args = [
  `--user-data-dir=${PROFILE}`,
  '--profile-directory=Default',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--window-size=1280,800',
  START_URL,
];

if (process.getuid?.() === 0) args.unshift('--no-sandbox');

console.log('\n👉 Opening real Chrome for Google login.');
console.log('   Chrome:', chromePath);
console.log('   When done, close the window — your session is saved to:');
console.log('  ', PROFILE, '\n');

const child = spawn(chromePath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
