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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const msg = body.message;
    if (!msg || !msg.chat?.id) return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const parts = text.split(/\s+/);
    const cityQuery = parts.length > 1 ? parts.slice(1).join(' ') : 'Bandung';
    const loc = await geocodeCity(cityQuery);

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const [wRes, sRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&hourly=precipitation_probability,weather_code&timezone=Asia%2FJakarta`),
      fetch(`https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${loc.lat}&longitude=${loc.lon}&method=20`)
    ]);
    const w = await wRes.json();
    const s = (await sRes.json()).data;
    const curTemp = Math.round(w.current.temperature_2m);
    const next6Prob = Math.max(...(w.hourly.precipitation_probability.slice(0, 6)), 0);
    const isBad = BAD_CODES.has(w.current.weather_code) || w.hourly.weather_code.slice(0, 6).some(c => BAD_CODES.has(c)) || next6Prob >= 65;
    const t = s.timings;

    const reply =
      `${isBad ? '⛈️ WEATHER ALERT — PREPARE FOR RAIN' : '🌤️ NUSANTARA WEATHER & SHALAT'}\n\n` +
      `📍 ${loc.name}\n` +
      `🌡️ Temp: ${curTemp}°C | 6h Rain Chance: ${next6Prob}%\n` +
      `${isBad ? '⚠️ Rain/thunderstorm is expected. Bring an umbrella/raincoat!' : '✅ Conditions look fair right now.'}\n\n` +
      `🕌 Shalat Today (WIB):\n` +
      `Subuh ${t.Fajr} • Dzuhur ${t.Dhuhr} • Ashar ${t.Asr}\n` +
      `Maghrib ${t.Maghrib} • Isya ${t.Isha}\n\n` +
      `💡 Send "/start Jakarta" or "/cuaca Surabaya" to check any city.`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply })
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
