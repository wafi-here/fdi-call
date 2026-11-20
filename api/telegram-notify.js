export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });
  }
  try {
    const { chat_id, text } = req.body || {};
    const targetChat = chat_id || process.env.TELEGRAM_CHAT_ID;
    if (!targetChat || !text) {
      return res.status(400).json({ ok: false, error: 'Missing chat_id or text' });
    }
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: targetChat, text })
    });
    const data = await resp.json();
    return res.status(resp.ok ? 200 : 400).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
