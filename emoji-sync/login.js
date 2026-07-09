// One-time login: generates TG_SESSION string. Paste output into .env / secrets.
import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
if (!apiId || !apiHash) {
  console.error('Set TG_API_ID and TG_API_HASH in .env first.');
  process.exit(1);
}

const stringSession = new StringSession('');
const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber: async () => await input.text('📱 Phone number (with +country code): '),
  password: async () => await input.text('🔒 2FA password (blank if none): '),
  phoneCode: async () => await input.text('💬 OTP code from Telegram: '),
  onError: (err) => console.error(err),
});

console.log('\n\n✅ Login successful!\n');
console.log('===== COPY THIS SESSION STRING =====\n');
console.log(client.session.save());
console.log('\n====================================');
console.log('Save it as TG_SESSION secret / .env value. Do NOT share it.');
await client.disconnect();
process.exit(0);
