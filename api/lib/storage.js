// Storage provider for Nox Promo Codes
// Supports:
// 1. Vercel KV / Upstash Redis (if KV_REST_API_URL is configured)
// 2. Telegram Pinned Message Storage (Zero-config, uses TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID)
// 3. In-memory fallback

const DEFAULT_PROMOS = {
  'NOX10':   { discount: 0.10, partner: 'Официальный', uses: 0, active: true },
  'SLEEP10': { discount: 0.10, partner: 'Циркадный клуб', uses: 0, active: true },
  'MALIKA':  { discount: 0.10, partner: 'Малика', uses: 0, active: true },
  'JASUR':   { discount: 0.10, partner: 'Жасур (Фитнес)', uses: 0, active: true },
  'TIKTOK':  { discount: 0.10, partner: 'TikTok Promo', uses: 0, active: true },
  'SPECIAL': { discount: 0.15, partner: 'VIP', uses: 0, active: true }
};

let memCache = null;
let cacheTime = 0;
let cachedPinnedMsgId = null;
const CACHE_TTL_MS = 15000; // 15 seconds cache

export async function getPromos() {
  const now = Date.now();
  if (memCache && (now - cacheTime < CACHE_TTL_MS)) {
    return memCache;
  }

  // 1. Check Vercel KV
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(`${process.env.KV_REST_API_URL}/get/nox_promos`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const data = await res.json();
      if (data && data.result) {
        const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        memCache = parsed;
        cacheTime = now;
        return parsed;
      }
    } catch (e) {
      console.warn('KV read failed:', e.message);
    }
  }

  // 2. Check Telegram Pinned Message
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`);
      const tgData = await tgRes.json();
      if (tgData.ok && tgData.result && tgData.result.pinned_message) {
        const pin = tgData.result.pinned_message;
        cachedPinnedMsgId = pin.message_id;
        const text = pin.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed && parsed.promos) {
            memCache = parsed.promos;
            cacheTime = now;
            return parsed.promos;
          }
        }
      }

      // If no pinned message yet, initialize it
      const initialData = { _nox: 1, promos: DEFAULT_PROMOS };
      const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🌙 <b>[NOX DB] Реестр промокодов</b>\n<i>Этот пост синхронизирует промокоды для сайта. Не удаляйте его.</i>\n\n<pre>${JSON.stringify(initialData, null, 2)}</pre>`,
          parse_mode: 'HTML'
        })
      });
      const sendData = await sendRes.json();
      if (sendData.ok && sendData.result) {
        cachedPinnedMsgId = sendData.result.message_id;
        await fetch(`https://api.telegram.org/bot${botToken}/pinChatMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: cachedPinnedMsgId,
            disable_notification: true
          })
        });
      }
      memCache = DEFAULT_PROMOS;
      cacheTime = now;
      return DEFAULT_PROMOS;
    } catch (e) {
      console.warn('Telegram pinned message read failed:', e.message);
    }
  }

  memCache = DEFAULT_PROMOS;
  cacheTime = now;
  return DEFAULT_PROMOS;
}

export async function savePromos(promos) {
  memCache = promos;
  cacheTime = Date.now();

  // 1. Save to KV if available
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(`${process.env.KV_REST_API_URL}/set/nox_promos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(promos))
      });
    } catch (e) {
      console.warn('KV save failed:', e.message);
    }
  }

  // 2. Save to Telegram Pinned Message
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    try {
      if (!cachedPinnedMsgId) {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`);
        const tgData = await tgRes.json();
        if (tgData.ok && tgData.result && tgData.result.pinned_message) {
          cachedPinnedMsgId = tgData.result.pinned_message.message_id;
        }
      }

      const payload = { _nox: 1, updated: new Date().toISOString(), promos };
      const text = `🌙 <b>[NOX DB] Реестр промокодов</b>\n<i>Этот пост синхронизирует промокоды для сайта. Не удаляйте его.</i>\n\n<pre>${JSON.stringify(payload, null, 2)}</pre>`;

      if (cachedPinnedMsgId) {
        const editRes = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: cachedPinnedMsgId,
            text,
            parse_mode: 'HTML'
          })
        });
        const editData = await editRes.json();
        if (!editData.ok) {
          console.warn('editMessageText failed, re-sending:', editData);
          cachedPinnedMsgId = null;
        }
      }

      if (!cachedPinnedMsgId) {
        const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML'
          })
        });
        const sendData = await sendRes.json();
        if (sendData.ok && sendData.result) {
          cachedPinnedMsgId = sendData.result.message_id;
          await fetch(`https://api.telegram.org/bot${botToken}/pinChatMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: cachedPinnedMsgId,
              disable_notification: true
            })
          });
        }
      }
    } catch (e) {
      console.warn('Telegram save failed:', e.message);
    }
  }

  return true;
}

export async function addPromo(code, discount, partner = '') {
  const cleanCode = String(code).trim().toUpperCase();
  let discNum = parseFloat(discount);
  if (!cleanCode) throw new Error('Код промокода не может быть пустым');
  if (isNaN(discNum) || discNum <= 0) {
    throw new Error('Скидка должна быть числом больше 0 (например, 10 для 10%)');
  }
  if (discNum >= 1) {
    discNum = discNum / 100;
  }
  if (discNum > 0.9) {
    throw new Error('Скидка не может превышать 90%');
  }

  const promos = await getPromos();
  promos[cleanCode] = {
    discount: discNum,
    partner: partner ? String(partner).trim() : 'Партнер',
    uses: (promos[cleanCode] && promos[cleanCode].uses) || 0,
    active: true,
    created: new Date().toISOString()
  };

  await savePromos(promos);
  return promos[cleanCode];
}

export async function delPromo(code) {
  const cleanCode = String(code).trim().toUpperCase();
  const promos = await getPromos();
  if (!promos[cleanCode]) {
    return false;
  }
  delete promos[cleanCode];
  await savePromos(promos);
  return true;
}

export async function incrementPromoUses(code) {
  if (!code) return;
  const cleanCode = String(code).trim().toUpperCase();
  const promos = await getPromos();
  if (promos[cleanCode]) {
    promos[cleanCode].uses = (promos[cleanCode].uses || 0) + 1;
    await savePromos(promos);
  }
}
