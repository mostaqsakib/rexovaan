// Open a headful Chrome window with the persistent profile so you can
// sign into Google (or any other site) once. After login, close the
// window — cookies persist in CHROME_PROFILE_DIR and the browser
// fallback in checker.js will reuse them.
//
// Usage:   HEADFUL=true node login.js

import 'dotenv/config';
import { chromium } from 'playwright';

const {
  CHROME_PROFILE_DIR = '/root/tg-checker-chrome-profile',
  CHROME_CHANNEL = 'chrome',
  CHROME_EXECUTABLE_PATH = '',
} = process.env;

const launchOptions = {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
  locale: 'en-US',
};
if (CHROME_EXECUTABLE_PATH) launchOptions.executablePath = CHROME_EXECUTABLE_PATH;
else if (CHROME_CHANNEL) launchOptions.channel = CHROME_CHANNEL;

const ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);
const page = await ctx.newPage();
await page.goto('https://accounts.google.com');
console.log('\n👉 Sign in, then close the browser window when done.\n');
await ctx.waitForEvent('close', { timeout: 0 });
console.log('✅ Profile saved at', CHROME_PROFILE_DIR);
process.exit(0);
