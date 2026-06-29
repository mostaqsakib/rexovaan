import 'dotenv/config';
import { chromium } from 'playwright';

const {
  CHROME_PROFILE_DIR = '/root/tg-checker-chrome-profile',
  CHROME_CHANNEL = 'chrome',
  CHROME_EXECUTABLE_PATH = '',
  NAV_TIMEOUT_MS = '15000',
} = process.env;

const url = process.argv[2] || 'https://accounts.google.com';

const launchOptions = {
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
  locale: 'en-US',
};

if (CHROME_EXECUTABLE_PATH) launchOptions.executablePath = CHROME_EXECUTABLE_PATH;
else if (CHROME_CHANNEL) launchOptions.channel = CHROME_CHANNEL;

const ctx = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);

try {
  const accountCookies = await ctx.cookies('https://accounts.google.com');
  const activationCookies = await ctx.cookies('https://serviceactivation.google.com');
  const googleCookies = await ctx.cookies('https://google.com');
  console.log('Profile:', CHROME_PROFILE_DIR);
  console.log('Google cookie count:', accountCookies.length + activationCookies.length + googleCookies.length);

  const res = await ctx.request.get(url, {
    timeout: Number(NAV_TIMEOUT_MS),
    maxRedirects: 10,
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  const text = (await res.text()).toLowerCase();
  console.log('HTTP status:', res.status());
  console.log('Final URL:', res.url());
  console.log('Looks like Google login page:', /accounts\.google\.com\/(signin|servicelogin|v3\/signin|interactive_login|challenge)/i.test(res.url())
    || text.includes('sign in to continue')
    || text.includes('choose an account'));
  console.log('Has invalid marker:', text.includes('already been used') || text.includes('new activation link'));
} finally {
  await ctx.close();
}