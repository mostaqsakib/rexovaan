// One-time login helper. Run this on the VPS over noVNC/VNC display to log into
// Google with your persistent Chrome profile. After you log in once, close the
// window — the profile stays logged in for months.
//
// Usage:   node login.js
import 'dotenv/config';
import { chromium } from 'playwright';

const PROFILE = process.env.CHROME_PROFILE_DIR || '/root/chrome-profile';

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://accounts.google.com/');

console.log('\n👉 Log into Google in the opened window.');
console.log('   When done, close the window — your session is saved to:');
console.log('  ', PROFILE, '\n');

// Wait until user closes the browser
await new Promise((resolve) => ctx.on('close', resolve));
process.exit(0);
