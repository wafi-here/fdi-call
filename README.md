# Nusantara Pulse — Indonesia Weather, Shalat & Telegram Alert Dashboard

Free, zero-API-key dashboard for Indonesian city & subdistrict weather forecasts, Kemenag Shalat times, and Telegram bad-weather alerts (`@fdicallbot`).

## Free Deployment (Netlify or Vercel)

### Option 1: Netlify
1. Drag and drop this folder to https://app.netlify.com/drop (or connect via GitHub).
2. (Optional, recommended for security) In Netlify **Site Settings → Environment Variables**, add `TELEGRAM_BOT_TOKEN` =.
3. In the dashboard's **Telegram Bot** tab, switch Delivery Mode to **Netlify Function**.

### Option 2: Vercel
1. Import this folder at https://vercel.com/new.
2. Add Environment Variable `TELEGRAM_BOT_TOKEN`, `UPSTASH_REDIS_REST_URL`,`UPSTASH_REDIS_REST_TOKEN`
3. In the dashboard's **Telegram Bot** tab, switch Delivery Mode to **Vercel Serverless**.
