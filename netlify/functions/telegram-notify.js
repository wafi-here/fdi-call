exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }) };
  }
  try {
    const { chat_id, text } = JSON.parse(event.body || '{}');
    const targetChat = chat_id || process.env.TELEGRAM_CHAT_ID;
    if (!targetChat || !text) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing chat_id or text' }) };
    }
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: targetChat, text })
    });
    const data = await resp.json();
    return { statusCode: resp.ok ? 200 : 400, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
