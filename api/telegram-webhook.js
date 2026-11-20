const BAD_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);

async function geocodeCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&countryCode=ID`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.results && d.results.length) {
    const hit = d.results[0];
    return { name: hit.admin2 ? `${hit.name}, ${hit.admin2}` : hit.name, lat: hit.latitude, lon: hit.longitude };
  }
  return { name: 'Coblong, Kota Bandung', lat: -6.8879, lon: 107.6152 };
}

async function getWeatherAndShalat(lat, lon) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const [wRes, sRes] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=precipitation_probability,weather_code&timezone=Asia%2FJakarta`),
    fetch(`https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${lat}&longitude=${lon}&method=20`)
  ]);
  const w = await wRes.json();
  const s = await sRes.json();
  return { w, s: s.data };
}

async function saveSubscriber(chatId, loc) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  await fetch(`${url}/hset/nusantara_subs/${chatId}/${encodeURIComponent(JSON.stringify(loc))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return true;
}

async function removeSubscriber(chatId) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  await fetch(`${url}/hdel/nusantara_subs/${chatId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, status: 'Webhook ready' });
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(500).json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' });

  try {
    const msg = req.body?.message;
    if (!msg || !msg.chat?.id) return res.status(200).json({ ok: true });
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (text.startsWith('/stop')) {
      await removeSubscriber(chatId);
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '🔕 Unsubscribed from automatic weather alerts. Send /start anytime to re-enable.' })
      });
      return res.status(200).json({ ok: true });
    }

    const parts = text.split(/\s+/);
    const cityQuery = parts.length > 1 ? parts.slice(1).join(' ') : 'Bandung';
    const loc = await geocodeCity(cityQuery);
    const { w, s } = await getWeatherAndShalat(loc.lat, loc.lon);

    const curTemp = Math.round(w.current.temperature_2m);
    const curCode = w.current.weather_code;
    const next6Prob = Math.max(...(w.hourly.precipitation_probability.slice(0, 6)), 0);
    const isBad = BAD_CODES.has(curCode) || w.hourly.weather_code.slice(0, 6).some(c => BAD_CODES.has(c)) || next6Prob >= 65;
    const subscribed = await saveSubscriber(chatId, loc);

    const t = s.timings;
    const reply =
      `${isBad ? '⛈️ WEATHER ALERT — PREPARE FOR RAIN' : '🌤️ NUSANTARA WEATHER & SHALAT'}\n\n` +
      `📍 ${loc.name}\n` +
      `🌡️ Temp: ${curTemp}°C | 6h Rain Chance: ${next6Prob}%\n` +
      `${isBad ? '⚠️ Rain/thunderstorm is expected. Bring an umbrella/raincoat!' : '✅ Conditions look fair right now.'}\n\n` +
      `🕌 Shalat Today (WIB):\n` +
      `Subuh ${t.Fajr} • Dzuhur ${t.Dhuhr} • Ashar ${t.Asr}\n` +
      `Maghrib ${t.Maghrib} • Isya ${t.Isha}\n\n` +
      `💡 Tip: Send "/start Jakarta" or "/cuaca Surabaya" to switch city.${subscribed ? '\n🔔 Auto-alerts enabled!' : ''}`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply })
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
