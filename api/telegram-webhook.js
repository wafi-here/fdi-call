const DEFAULT_LOCATION = { name: 'Coblong, Kota Bandung', lat: -6.8879, lon: 107.6152 };

const WMO_MAP = {
  0: { label: 'Clear', idLabel: 'Cerah', icon: '☀️', bad: false },
  1: { label: 'Mostly Clear', idLabel: 'Cerah Berawan', icon: '🌤️', bad: false },
  2: { label: 'Partly Cloudy', idLabel: 'Berawan Sebagian', icon: '⛅', bad: false },
  3: { label: 'Cloudy', idLabel: 'Berawan', icon: '☁️', bad: false },
  45: { label: 'Foggy', idLabel: 'Berkabut', icon: '🌫️', bad: false },
  48: { label: 'Dense Fog', idLabel: 'Kabut Tebal', icon: '🌫️', bad: false },
  51: { label: 'Light Drizzle', idLabel: 'Gerimis', icon: '🌦️', bad: true },
  53: { label: 'Drizzle', idLabel: 'Gerimis Sedang', icon: '🌦️', bad: true },
  55: { label: 'Heavy Drizzle', idLabel: 'Gerimis Lebat', icon: '🌧️', bad: true },
  61: { label: 'Light Rain', idLabel: 'Hujan Ringan', icon: '🌧️', bad: true },
  63: { label: 'Moderate Rain', idLabel: 'Hujan Sedang', icon: '🌧️', bad: true },
  65: { label: 'Heavy Rain', idLabel: 'Hujan Lebat', icon: '🌧️', bad: true },
  80: { label: 'Rain Showers', idLabel: 'Hujan Lokal', icon: '🌦️', bad: true },
  81: { label: 'Heavy Showers', idLabel: 'Hujan Deras', icon: '🌧️', bad: true },
  82: { label: 'Violent Showers', idLabel: 'Hujan Ekstrem', icon: '⛈️', bad: true },
  95: { label: 'Thunderstorm', idLabel: 'Hujan Petir', icon: '⛈️', bad: true },
  96: { label: 'Thunderstorm', idLabel: 'Badai Petir', icon: '⛈️', bad: true },
  99: { label: 'Severe Storm', idLabel: 'Badai Ekstrem', icon: '⛈️', bad: true }
};

function getWmo(code) {
  return WMO_MAP[code] || { label: `Code ${code}`, idLabel: 'Berawan', icon: '☁️', bad: code >= 51 };
}

function getJakartaDateParts() {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const [yyyy, mm, dd] = iso.split('-');
  return { iso, dd, mm, yyyy };
}

function getHourlyStartIndex(weather) {
  const times = weather?.hourly?.time;
  if (!times || !times.length) return 0;
  const curPrefix = (weather.current?.time || '').slice(0, 13);
  if (!curPrefix) return 0;
  const idx = times.findIndex(t => t >= curPrefix);
  return idx >= 0 ? idx : 0;
}

async function geocodeCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&countryCode=ID`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.results && d.results.length) {
    const hit = d.results[0];
    return { name: hit.admin2 ? `${hit.name}, ${hit.admin2}` : hit.name, lat: hit.latitude, lon: hit.longitude };
  }
  return null;
}

async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Asia%2FJakarta`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather API failed');
  return res.json();
}

async function fetchShalatTimes(lat, lon) {
  const { dd, mm, yyyy } = getJakartaDateParts();
  const res = await fetch(`https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${lat}&longitude=${lon}&method=20`);
  if (!res.ok) throw new Error('Shalat API failed');
  const json = await res.json();
  return json.data;
}

async function redisCommand(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!res.ok) return null;
  return res.json();
}

async function getSubscriber(chatId) {
  const data = await redisCommand(['HGET', 'nusantara_subs', String(chatId)]);
  if (!data?.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

async function saveSubscriber(chatId, loc) {
  const data = await redisCommand(['HSET', 'nusantara_subs', String(chatId), JSON.stringify(loc)]);
  return data !== null;
}

async function removeSubscriber(chatId) {
  const data = await redisCommand(['HDEL', 'nusantara_subs', String(chatId)]);
  return data !== null;
}

function analyzeRisk(w) {
  const startIdx = getHourlyStartIndex(w);
  const next6Probs = w.hourly.precipitation_probability.slice(startIdx, startIdx + 6);
  const next6Codes = w.hourly.weather_code.slice(startIdx, startIdx + 6);
  const maxProb = Math.max(...next6Probs, 0);
  const curWmo = getWmo(w.current.weather_code);
  const badCode = curWmo.bad ? w.current.weather_code : next6Codes.find(c => getWmo(c).bad);
  const isBad = Boolean(badCode !== undefined || maxProb >= 65);
  return { isBad, maxProb, curWmo, triggerWmo: badCode !== undefined ? getWmo(badCode) : curWmo };
}

function findNextPrayer(timings) {
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date());
  const prayers = [
    { label: 'Subuh', time: timings.Fajr },
    { label: 'Dzuhur', time: timings.Dhuhr },
    { label: 'Ashar', time: timings.Asr },
    { label: 'Maghrib', time: timings.Maghrib },
    { label: 'Isya', time: timings.Isha }
  ];
  return prayers.find(p => p.time.slice(0, 5) > nowStr) || { ...prayers[0], tomorrow: true };
}

function formatWeatherPrediction(loc, w) {
  const risk = analyzeRisk(w);
  const { iso } = getJakartaDateParts();
  const slots = [
    { label: 'Morning (06:00)', hour: '06:00' },
    { label: 'Afternoon (12:00)', hour: '12:00' },
    { label: 'Evening (18:00)', hour: '18:00' },
    { label: 'Night (21:00)', hour: '21:00' }
  ];
  const slotLines = slots.map(slot => {
    const idx = w.hourly.time.findIndex(t => t === `${iso}T${slot.hour}`);
    if (idx < 0) return null;
    const wmo = getWmo(w.hourly.weather_code[idx]);
    const temp = Math.round(w.hourly.temperature_2m[idx]);
    const prob = w.hourly.precipitation_probability[idx];
    return `• ${slot.label}: ${wmo.icon} ${wmo.label}, ${temp}°C (${prob}% rain)`;
  }).filter(Boolean).join('\n');

  const maxT = Math.round(w.daily.temperature_2m_max[0]);
  const minT = Math.round(w.daily.temperature_2m_min[0]);
  const dayProb = w.daily.precipitation_probability_max[0];

  return (
    `${risk.isBad ? '⛈️ TODAY\'S WEATHER PREDICTION — ALERT' : '🌤️ TODAY\'S WEATHER PREDICTION'}\n\n` +
    `📍 ${loc.name}\n` +
    `${risk.curWmo.icon} Now: ${risk.curWmo.label} (${risk.curWmo.idLabel})\n` +
    `🌡️ Temp: ${Math.round(w.current.temperature_2m)}°C (Feels ${Math.round(w.current.apparent_temperature)}°C)\n` +
    `💧 Humidity: ${w.current.relative_humidity_2m}% • 💨 Wind: ${Math.round(w.current.wind_speed_10m)} km/h\n` +
    `📊 Today Range: ${minT}°C – ${maxT}°C | Max Rain Chance: ${dayProb}%\n\n` +
    `🕒 Today's Outlook:\n${slotLines || '• Hourly outlook unavailable'}\n\n` +
    `${risk.isBad ? `⚠️ 6h Rain Risk: ${risk.maxProb}% (${risk.triggerWmo.idLabel}) — bring an umbrella!` : `✅ 6h Rain Risk: ${risk.maxProb}% — conditions look fair.`}`
  );
}

function formatShalatMessage(loc, s) {
  const t = s.timings;
  const nextP = findNextPrayer(t);
  const hijri = `${s.date.hijri.day} ${s.date.hijri.month.en} ${s.date.hijri.year} H`;
  return (
    `🕌 SHALAT SCHEDULE (KEMENAG RI)\n\n` +
    `📍 ${loc.name}\n` +
    `📅 ${s.date.readable} • ${hijri}\n` +
    `⏳ Next: ${nextP.label} at ${nextP.time}${nextP.tomorrow ? ' (tomorrow)' : ''} WIB\n\n` +
    `• Imsak:   ${t.Imsak}\n` +
    `• Subuh:   ${t.Fajr}\n` +
    `• Terbit:  ${t.Sunrise}\n` +
    `• Dzuhur:  ${t.Dhuhr}\n` +
    `• Ashar:   ${t.Asr}\n` +
    `• Maghrib: ${t.Maghrib}\n` +
    `• Isya:    ${t.Isha}`
  );
}

function formatHelpMessage() {
  return (
    `🤖 NUSANTARA WEATHER & SHALAT BOT\n\n` +
    `Available Commands:\n` +
    `• /start [city] — Subscribe & get current summary\n` +
    `• /setlocation <city> (or /lokasi) — Set your alert city\n` +
    `• 📍 Send Location Pin — Set exact GPS coordinates\n` +
    `• /weather [city] (or /cuaca) — Today's full weather prediction\n` +
    `• /shalat [city] (or /jadwal) — Today's Kemenag RI prayer times\n` +
    `• /status — Check your saved location & alert status\n` +
    `• /stop — Unsubscribe from auto rain alerts\n` +
    `• /help — Show this command list\n\n` +
    `💡 Example: /setlocation Surabaya`
  );
}

const DEFAULT_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🌦️ Today\'s Weather', callback_data: 'cmd:weather' },
      { text: '🕌 Shalat Times', callback_data: 'cmd:shalat' }
    ],
    [
      { text: '📊 My Status', callback_data: 'cmd:status' },
      { text: '❓ Help', callback_data: 'cmd:help' }
    ]
  ]
};

async function sendTelegram(botToken, method, payload) {
  return fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function resolveLocation(chatId, cityQuery) {
  if (cityQuery) {
    const found = await geocodeCity(cityQuery);
    if (found) return { loc: found, notFound: false };
    return { loc: null, notFound: true };
  }
  const saved = await getSubscriber(chatId);
  return { loc: saved || DEFAULT_LOCATION, notFound: false };
}

async function handleCommand(botToken, chatId, text, locationPin) {
  if (locationPin) {
    const loc = {
      name: `Pinned (${locationPin.latitude.toFixed(3)}, ${locationPin.longitude.toFixed(3)})`,
      lat: locationPin.latitude,
      lon: locationPin.longitude
    };
    const saved = await saveSubscriber(chatId, loc);
    const [w, s] = await Promise.all([fetchWeather(loc.lat, loc.lon), fetchShalatTimes(loc.lat, loc.lon)]);
    const nextP = findNextPrayer(s.timings);
    const msg =
      `📍 Notification location updated!\n` +
      `Coordinates: ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}\n` +
      `🔔 Auto-alerts: ${saved ? 'Active' : 'Configure Upstash Redis for scheduled alerts'}\n\n` +
      `${formatWeatherPrediction(loc, w)}\n\n` +
      `🕌 Next Shalat: ${nextP.label} at ${nextP.time} WIB`;
    await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: msg, reply_markup: DEFAULT_KEYBOARD });
    return;
  }

  const trimmed = (text || '').trim();
  const [rawCmd, ...rest] = trimmed.split(/\s+/);
  const cmd = rawCmd.startsWith('/') ? rawCmd.split('@')[0].toLowerCase() : '';
  const arg = rest.join(' ').trim();

  if (cmd === '/help') {
    await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: formatHelpMessage(), reply_markup: DEFAULT_KEYBOARD });
    return;
  }

  if (cmd === '/stop') {
    await removeSubscriber(chatId);
    await sendTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: '🔕 Unsubscribed from automatic weather alerts. Send /start or /setlocation anytime to re-enable.'
    });
    return;
  }

  if (cmd === '/setlocation' || cmd === '/lokasi') {
    if (!arg) {
      await sendTelegram(botToken, 'sendMessage', {
        chat_id: chatId,
        text: '📍 Send a city/subdistrict name or attach a Telegram Location pin.\nExample: /setlocation Jakarta Selatan'
      });
      return;
    }
    const found = await geocodeCity(arg);
    if (!found) {
      await sendTelegram(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `❌ Could not find "${arg}" in Indonesia. Try another city or subdistrict name.`
      });
      return;
    }
    const saved = await saveSubscriber(chatId, found);
    const w = await fetchWeather(found.lat, found.lon);
    const risk = analyzeRisk(w);
    await sendTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text:
        `✅ Alert location saved: ${found.name}\n` +
        `🔔 Auto rain alerts: ${saved ? 'Enabled' : 'Pending (Upstash Redis not configured)'}\n` +
        `${risk.curWmo.icon} Current: ${risk.curWmo.label}, ${Math.round(w.current.temperature_2m)}°C (6h rain risk: ${risk.maxProb}%)`,
      reply_markup: DEFAULT_KEYBOARD
    });
    return;
  }

  if (cmd === '/status') {
    const saved = await getSubscriber(chatId);
    const loc = saved || DEFAULT_LOCATION;
    const w = await fetchWeather(loc.lat, loc.lon);
    const risk = analyzeRisk(w);
    await sendTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text:
        `📊 YOUR BOT STATUS\n\n` +
        `📍 Saved Location: ${saved ? saved.name : `${DEFAULT_LOCATION.name} (default)`}\n` +
        `🌐 Coords: ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}\n` +
        `🔔 Auto Alerts: ${saved ? 'Subscribed' : 'Not subscribed (send /setlocation <city>)'}\n` +
        `${risk.curWmo.icon} 6h Rain Risk: ${risk.maxProb}% (${risk.curWmo.label})`,
      reply_markup: DEFAULT_KEYBOARD
    });
    return;
  }

  if (cmd === '/weather' || cmd === '/cuaca' || cmd === '/forecast') {
    const { loc, notFound } = await resolveLocation(chatId, arg);
    if (notFound) {
      await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: `❌ Location "${arg}" not found in Indonesia.` });
      return;
    }
    const w = await fetchWeather(loc.lat, loc.lon);
    await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: formatWeatherPrediction(loc, w), reply_markup: DEFAULT_KEYBOARD });
    return;
  }

  if (cmd === '/shalat' || cmd === '/jadwal') {
    const { loc, notFound } = await resolveLocation(chatId, arg);
    if (notFound) {
      await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: `❌ Location "${arg}" not found in Indonesia.` });
      return;
    }
    const s = await fetchShalatTimes(loc.lat, loc.lon);
    await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: formatShalatMessage(loc, s), reply_markup: DEFAULT_KEYBOARD });
    return;
  }

  if (cmd === '/start' || !cmd) {
    const cityArg = cmd === '/start' ? arg : trimmed;
    const { loc, notFound } = await resolveLocation(chatId, cityArg);
    if (notFound) {
      await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: `❌ Location "${cityArg}" not found. Try /start Bandung or /help.` });
      return;
    }
    const subscribed = await saveSubscriber(chatId, loc);
    const [w, s] = await Promise.all([fetchWeather(loc.lat, loc.lon), fetchShalatTimes(loc.lat, loc.lon)]);
    const nextP = findNextPrayer(s.timings);
    const msg =
      `${formatWeatherPrediction(loc, w)}\n\n` +
      `🕌 Next Shalat: ${nextP.label} at ${nextP.time} WIB\n` +
      `${subscribed ? '🔔 Auto rain alerts enabled for this location!' : 'ℹ️ Tip: Send /help for all commands.'}`;
    await sendTelegram(botToken, 'sendMessage', { chat_id: chatId, text: msg, reply_markup: DEFAULT_KEYBOARD });
    return;
  }

  await sendTelegram(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `❓ Unknown command "${cmd}". Send /help to see available commands.`,
    reply_markup: DEFAULT_KEYBOARD
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, status: 'Webhook ready' });
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(500).json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const cb = body.callback_query;
    if (cb?.message?.chat?.id && cb.data?.startsWith('cmd:')) {
      await sendTelegram(botToken, 'answerCallbackQuery', { callback_query_id: cb.id });
      const action = '/' + cb.data.slice(4);
      await handleCommand(botToken, cb.message.chat.id, action, null);
      return res.status(200).json({ ok: true });
    }

    const msg = body.message;
    if (!msg || !msg.chat?.id) return res.status(200).json({ ok: true });
    await handleCommand(botToken, msg.chat.id, msg.text, msg.location);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
