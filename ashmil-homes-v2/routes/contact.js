const express = require('express');
const router = express.Router();

/* ============================================================
   CONFIG
   ============================================================ */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

const telegramEnabled = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

if (!telegramEnabled) {
  console.warn('⚠️  Contact form: Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel env vars.');
} else {
  console.log('✅ Contact form: Telegram notifications enabled.');
}

/* ============================================================
   RATE LIMITING (in-memory, per-IP)
   3 submissions per 10 minutes — tune as needed.
   ============================================================ */

const submissions = new Map(); // ip -> { count, firstAt }
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX       = 3;

function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip || 'unknown';
  const now = Date.now();
  const entry = submissions.get(ip);

  if (!entry || now - entry.firstAt > RATE_WINDOW_MS) {
    submissions.set(ip, { count: 1, firstAt: now });
    return next();
  }

  if (entry.count >= RATE_MAX) {
    const retrySec = Math.ceil((RATE_WINDOW_MS - (now - entry.firstAt)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Too many messages. Please wait ${Math.ceil(retrySec / 60)} minute(s) and try again.`
    });
  }

  entry.count += 1;
  next();
}

// Periodic cleanup so the Map doesn't grow forever.
// .unref() lets the Node process exit cleanly when idle.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of submissions.entries()) {
    if (now - entry.firstAt > RATE_WINDOW_MS) submissions.delete(ip);
  }
}, 5 * 60 * 1000).unref?.();

/* ============================================================
   HELPERS
   ============================================================ */

const LIMITS = {
  name:    100,
  email:   254,
  phone:   30,
  message: 4000
};

function truncate(str, max) {
  return String(str).slice(0, max);
}

// Telegram HTML parse mode requires escaping &, <, >.
// Without this, a message containing "<" or "&" would be rejected by the API.
function escapeTelegramHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

/* ============================================================
   TELEGRAM SENDER
   Sends a formatted message to your configured chat.
   Uses HTML parse mode; all user content is escaped first.
   ============================================================ */

async function sendToTelegram({ name, email, phone, message }) {
  const timestamp = new Date().toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const text = [
    '<b>New Enquiry — Ashmil Homes</b>',
    '',
    `<b>Name:</b> ${escapeTelegramHtml(name)}`,
    `<b>Email:</b> ${escapeTelegramHtml(email)}`,
    phone ? `<b>Phone:</b> ${escapeTelegramHtml(phone)}` : null,
    '',
    '<b>Message:</b>',
    escapeTelegramHtml(message),
    '',
    `<i>Received ${escapeTelegramHtml(timestamp)}</i>`
  ].filter(Boolean).join('\n');

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.description || `Telegram API responded ${res.status}`);
    }

    return { ok: true };
  } finally {
    clearTimeout(timeout);
  }
}

/* ============================================================
   POST /api/contact
   Body: { name, email, phone?, message, source?, timestamp? }
   Returns: { success: true } on delivery, { success: false, error } otherwise.
   ============================================================ */

router.post('/', rateLimit, async (req, res) => {
  try {
    const body = req.body || {};

    // --- Extract + trim ---
    const name    = String(body.name    || '').trim();
    const email   = String(body.email   || '').trim();
    const phone   = String(body.phone   || '').trim();
    const message = String(body.message || '').trim();

    // --- Validation ---
    if (!name || name.length < 2) {
      return res.status(400).json({ success: false, error: 'Please enter your full name.' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }
    if (!message || message.length < 10) {
      return res.status(400).json({ success: false, error: 'Please enter a message (at least 10 characters).' });
    }

    // --- Length caps ---
    const payload = {
      name:    truncate(name,    LIMITS.name),
      email:   truncate(email,   LIMITS.email),
      phone:   truncate(phone,   LIMITS.phone),
      message: truncate(message, LIMITS.message)
    };

    // --- Delivery ---
    if (!telegramEnabled) {
      console.error('❌ Contact form received but Telegram is not configured.');
      return res.status(500).json({
        success: false,
        error: 'Message system is not configured. Please contact us directly via WhatsApp or phone.'
      });
    }

    try {
      await sendToTelegram(payload);
      return res.json({ success: true });
    } catch (err) {
      console.error('❌ Telegram send failed:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Could not deliver your message. Please try again or reach us on WhatsApp.'
      });
    }

  } catch (err) {
    console.error('❌ Contact route error:', err);
    res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
