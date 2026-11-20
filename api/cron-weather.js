const BAD_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);

function getHourlyStartIndex(w) {
  const times = w?.hourly?.time;
  if (!times || !times.length) return 0;
  const curPrefix = (w.current?.time || '').slice(0, 13);
  if (!curPrefix) return 0;
  const idx = times.findIndex(t => t >= curPrefix);
  return idx >= 0 ? idx : 0;
}

export default async function handler(req, res) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!botToken || !redisUrl || !redisToken) {
    return res.status(200).json({ ok: false, note: 'Configure TELEGRAM_BOT_TOKEN + UPSTASH_REDIS_REST_URL/TOKEN for scheduled alerts.' });
  }
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const r = await fetch(`${redisUrl}/hgetall/nusantara_subs`, {
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const data = await r.json();
    const list = data.result || [];
    let notified = 0;

    for (let i = 0; i < list.length; i += 2) {
      const chatId = list[i];
      const loc = JSON.parse(list[i + 1]);
      const wRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&hourly=precipitation_probability,weather_code&timezone=Asia%2FJakarta`
      );
      const w = await wRes.json();
      const startIdx = getHourlyStartIndex(w);
      const next6Probs = w.hourly.precipitation_probability.slice(startIdx, startIdx + 6);
      const next6Codes = w.hourly.weather_code.slice(startIdx, startIdx + 6);
      const maxProb = Math.max(...next6Probs, 0);
      const isBad = BAD_CODES.has(w.current.weather_code) || next6Codes.some(c => BAD_CODES.has(c)) || maxProb >= 65;
      if (isBad) {
        const text =
          `⛈️ RAIN / STORM ALERT\n` +
          `📍 ${loc.name}\n` +
          `🌡️ ${Math.round(w.current.temperature_2m)}°C | Next 6h Rain Chance: ${maxProb}%\n` +
          `⚠️ Prepare an umbrella or raincoat before heading out!\n\n` +
          `Send /weather for today's full forecast or /stop to pause alerts.`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text })
        });
        notified++;
      }
    }
    return res.status(200).json({ ok: true, notified });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
