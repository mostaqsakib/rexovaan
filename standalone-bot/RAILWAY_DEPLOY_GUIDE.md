# 🚀 Railway তে Telegram Bot Deploy করার সম্পূর্ণ গাইড

## ⚡ কেন Railway?
- Bot **instantly** respond করবে (কোনো 5s delay নেই)
- GitHub push করলেই **auto-deploy** হয়ে যায়
- **$5/month** থেকে শুরু
- কোনো server management লাগে না

---

## 📋 Step-by-Step Setup

### Step 1: GitHub এ Repository তৈরি করো

1. [github.com](https://github.com) এ যাও → **Sign In** করো (account না থাকলে Sign Up)
2. উপরে ডানে **"+"** button → **"New repository"** ক্লিক করো
3. নাম দাও: `rexovaan-bot` (বা তোমার পছন্দের নাম)
4. **Private** সিলেক্ট করো
5. **"Create repository"** ক্লিক করো

### Step 2: Bot এর কোড GitHub এ আপলোড করো

তোমার computer এ:

```bash
# 1. Git install না থাকলে install করো
# Windows: https://git-scm.com/download/win
# Mac: brew install git

# 2. standalone-bot ফোল্ডার এ যাও
cd standalone-bot

# 3. Git initialize করো
git init
git add .
git commit -m "Initial bot setup"

# 4. GitHub repo connect করো (username আর repo name বদলাও)
git remote add origin https://github.com/YOUR_USERNAME/rexovaan-bot.git
git branch -M main
git push -u origin main
```

**অথবা সহজ উপায়:** GitHub এর repository page এ গিয়ে **"Upload files"** button দিয়ে `bot.js`, `package.json`, `.env.example` — এই ৩টা ফাইল manually upload করো।

### Step 3: Railway Account তৈরি করো

1. [railway.app](https://railway.app) এ যাও
2. **"Login"** ক্লিক করো → **"Login with GitHub"** সিলেক্ট করো
3. GitHub account দিয়ে login করো
4. Railway তে credit card add করো ($5 credit দেবে):
   - Settings → Billing → Add Payment Method

### Step 4: Railway তে Project তৈরি করো

1. Railway Dashboard এ **"New Project"** ক্লিক করো
2. **"Deploy from GitHub Repo"** সিলেক্ট করো
3. তোমার `rexovaan-bot` repository সিলেক্ট করো
4. **"Deploy Now"** ক্লিক করো

### Step 5: Environment Variables সেট করো (সবচেয়ে গুরুত্বপূর্ণ!)

Railway Dashboard এ তোমার project এ ক্লিক করো → **"Variables"** tab এ যাও → **"New Variable"** ক্লিক করে একটা একটা করে add করো:

| Variable Name | কোথায় পাবে |
|---|---|
| `BOT_TOKEN` | @BotFather থেকে `/token` দিয়ে |
| `SUPABASE_URL` | `https://mxcuakzztajvkgtsocln.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable Cloud থেকে |
| `SUPABASE_ANON_KEY` | Lovable Cloud থেকে |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Cloud Console → Service Account → JSON key |
| `GOOGLE_SPREADSHEET_ID` | Google Sheet URL এর মাঝের অংশ |
| `ADMIN_CHAT_ID` | তোমার Telegram chat ID |
| `USDT_WALLET_ADDRESS` | তোমার BEP20 wallet address |
| `BINANCE_ID` | তোমার Binance ID |
| `BYBIT_UID` | তোমার Bybit UID |
| `USDT_TRC20_ADDRESS` | তোমার TRC20 address |
| `USDT_TON_ADDRESS` | তোমার TON address |
| `LTC_ADDRESS` | তোমার LTC address |
| `BINANCE_API_KEY` | Binance API Management থেকে |
| `BINANCE_API_SECRET` | Binance API Management থেকে |
| `BYBIT_API_KEY` | Bybit API Management থেকে |
| `BYBIT_API_SECRET` | Bybit API Management থেকে |

### Step 6: Deploy!

Variables সব set করার পর Railway automatically deploy শুরু করবে। 

- **Deployments** tab এ গিয়ে দেখো — green tick আসলে bot চালু!
- **Logs** tab এ দেখবে: `🤖 Bot started! Polling with offset...`

---

## ⚠️ গুরুত্বপূর্ণ: Edge Function Polling বন্ধ করো

Railway তে bot চালু হলে, Lovable Cloud এর cron polling বন্ধ করতে হবে (নাহলে দুইটা bot একসাথে চলবে, conflict হবে)।

আমাকে বলো, আমি cron job disable করে দেবো।

---

## 🔄 ভবিষ্যতে Update করতে

1. Lovable এ bot code change করো
2. GitHub এ push হবে auto
3. Railway auto-deploy করবে — **কিছু করা লাগবে না!**

অথবা manually:
```bash
git add .
git commit -m "Update bot"
git push
```

---

## 🛠️ Troubleshooting

| সমস্যা | সমাধান |
|---|---|
| Bot response দিচ্ছে না | Railway Logs চেক করো — কোনো error আছে কিনা |
| "BOT_TOKEN not set" | Variables tab এ BOT_TOKEN ঠিকমতো set করো |
| Deploy fail হচ্ছে | Logs দেখে error identify করো |
| Bot slow | Railway free plan এ cold start হতে পারে, $5 plan এ নেই |

---

## 💰 Cost

- **Hobby Plan:** $5/month (no sleeping, always on)
- Bot 24/7 চলবে, instant response দেবে
- প্রথম $5 free credit পাবে
