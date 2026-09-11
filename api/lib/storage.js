// Storage provider for Nox Promo Codes, Influencers & Order Completion
// Supports:
// 1. Vercel KV / Upstash Redis (if KV_REST_API_URL is configured)
// 2. Telegram Pinned Message Storage (Zero-config, uses TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID)
// 3. In-memory fallback

export const COMMISSION_SINGLE = 20000; // 20,000 UZS per single pair
export const COMMISSION_DUO = 30000;    // 30,000 UZS per set of 2

const DEFAULT_PROMOS = {
  'NOX10':   { discount: 0.10, partner: 'Официальный', uses: 0, completed: 0, singleCompleted: 0, duoCompleted: 0, earnings: 0, telegramId: '', active: true },
  'SLEEP10': { discount: 0.10, partner: 'Циркадный клуб', uses: 0, completed: 0, singleCompleted: 0, duoCompleted: 0, earnings: 0, telegramId: '', active: true },
  'MALIKA':  { discount: 0.10, partner: 'Малика', uses: 0, completed: 0, singleCompleted: 0, duoCompleted: 0, earnings: 0, telegramId: '', active: true },
  'JASUR':   { discount: 0.10, partner: 'Жасур (Фитнес)', uses: 0, completed: 0, singleCompleted: 0, duoCompleted: 0, earnings: 0, telegramId: '', active: true },
  'TIKTOK':  { discount: 0.10, partner: 'TikTok Promo', uses: 0, completed: 0, singleCompleted: 0, duoCompleted: 0, earnings: 0, telegramId: '', active: true },
  'SPECIAL': { discount: 0.15, partner: 'VIP', uses: 0, completed: 0, singleCompleted: 0, duoCompleted: 0, earnings: 0, telegramId: '', active: true }
};

let memCachePromos = null;
let memCacheOrders = {};
let cacheTime = 0;
let cachedPinnedMsgId = null;
const CACHE_TTL_MS = 15000; // 15 seconds cache

function normalizePromo(p) {
  if (!p) return null;
  const single = Number(p.singleCompleted || 0);
  const duo = Number(p.duoCompleted || 0);
  const completed = Number(p.completed !== undefined ? p.completed : (single + duo));
  const calculatedEarnings = (single * COMMISSION_SINGLE) + (duo * COMMISSION_DUO);
  return {
    code: p.code || '',
    discount: Number(p.discount || 0.10),
    partner: p.partner ? String(p.partner).trim() : 'Партнер',
    uses: Number(p.uses || 0),
    completed: completed,
    singleCompleted: single,
    duoCompleted: duo,
    earnings: typeof p.earnings === 'number' ? p.earnings : calculatedEarnings,
    telegramId: p.telegramId ? String(p.telegramId).trim() : '',
    active: p.active !== false,
    created: p.created || new Date().toISOString()
  };
}

function normalizePromosMap(map) {
  const normalized = {};
  if (!map || typeof map !== 'object') return DEFAULT_PROMOS;
  for (const [k, v] of Object.entries(map)) {
    const cleanKey = String(k).trim().toUpperCase();
    normalized[cleanKey] = normalizePromo({ ...v, code: cleanKey });
  }
  return normalized;
}

export async function getPromos() {
  const now = Date.now();
  if (memCachePromos && (now - cacheTime < CACHE_TTL_MS)) {
    return memCachePromos;
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
        memCachePromos = normalizePromosMap(parsed.promos || parsed);
        memCacheOrders = parsed.completedOrders || {};
        cacheTime = now;
        return memCachePromos;
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
          if (parsed && (parsed.promos || parsed._nox)) {
            memCachePromos = normalizePromosMap(parsed.promos || {});
            memCacheOrders = parsed.completedOrders || {};
            cacheTime = now;
            return memCachePromos;
          }
        }
      }

      // If no pinned message yet, initialize it
      const initialData = { _nox: 2, promos: DEFAULT_PROMOS, completedOrders: {} };
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
      memCachePromos = normalizePromosMap(DEFAULT_PROMOS);
      memCacheOrders = {};
      cacheTime = now;
      return memCachePromos;
    } catch (e) {
      console.warn('Telegram pinned message read failed:', e.message);
    }
  }

  memCachePromos = normalizePromosMap(DEFAULT_PROMOS);
  memCacheOrders = {};
  cacheTime = now;
  return memCachePromos;
}

export async function getCompletedOrders() {
  await getPromos();
  return memCacheOrders || {};
}

export async function savePromos(promos, completedOrders = null) {
  memCachePromos = normalizePromosMap(promos);
  if (completedOrders !== null) {
    memCacheOrders = completedOrders;
  }
  cacheTime = Date.now();

  const payload = {
    _nox: 2,
    updated: new Date().toISOString(),
    promos: memCachePromos,
    completedOrders: memCacheOrders
  };

  // 1. Save to KV if available
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(`${process.env.KV_REST_API_URL}/set/nox_promos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(payload))
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

export async function addPromo(code, discount, partner = '', telegramId = '') {
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
  const existing = promos[cleanCode] || {};

  promos[cleanCode] = normalizePromo({
    code: cleanCode,
    discount: discNum,
    partner: partner ? String(partner).trim() : (existing.partner || 'Партнер'),
    uses: existing.uses || 0,
    completed: existing.completed || 0,
    singleCompleted: existing.singleCompleted || 0,
    duoCompleted: existing.duoCompleted || 0,
    earnings: existing.earnings || 0,
    telegramId: telegramId ? String(telegramId).trim() : (existing.telegramId || ''),
    active: true,
    created: existing.created || new Date().toISOString()
  });

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
    promos[cleanCode].uses = (Number(promos[cleanCode].uses) || 0) + 1;
    await savePromos(promos);
  }
}

export async function completeOrder(orderId, promoCode = '', itemType = 'single') {
  const cleanCode = promoCode ? String(promoCode).trim().toUpperCase() : '';
  const cleanOrderId = orderId ? String(orderId).trim().toUpperCase() : '';
  const isDuo = String(itemType).toLowerCase().includes('duo') ||
                String(itemType).toLowerCase().includes('2') ||
                String(itemType).toLowerCase().includes('сет') ||
                String(itemType).toLowerCase().includes('двоих');
  const type = isDuo ? 'duo' : 'single';
  const commission = isDuo ? COMMISSION_DUO : COMMISSION_SINGLE;

  const completedOrders = await getCompletedOrders();
  if (cleanOrderId && completedOrders[cleanOrderId]) {
    return {
      alreadyCompleted: true,
      orderId: cleanOrderId,
      promoCode: cleanCode,
      credited: 0,
      itemType: type
    };
  }

  const promos = await getPromos();
  let credited = 0;
  let partnerName = '';

  if (cleanCode && promos[cleanCode]) {
    const p = promos[cleanCode];
    p.completed = (Number(p.completed) || 0) + 1;
    if (type === 'duo') {
      p.duoCompleted = (Number(p.duoCompleted) || 0) + 1;
    } else {
      p.singleCompleted = (Number(p.singleCompleted) || 0) + 1;
    }
    p.earnings = (Number(p.singleCompleted || 0) * COMMISSION_SINGLE) + (Number(p.duoCompleted || 0) * COMMISSION_DUO);
    partnerName = p.partner || 'Партнер';
    credited = commission;
  }

  if (cleanOrderId) {
    completedOrders[cleanOrderId] = {
      orderId: cleanOrderId,
      promoCode: cleanCode,
      itemType: type,
      credited,
      completedAt: new Date().toISOString()
    };
    const keys = Object.keys(completedOrders);
    if (keys.length > 100) {
      for (let i = 0; i < keys.length - 100; i++) {
        delete completedOrders[keys[i]];
      }
    }
  }

  await savePromos(promos, completedOrders);

  return {
    alreadyCompleted: false,
    orderId: cleanOrderId,
    promoCode: cleanCode,
    partnerName,
    itemType: type,
    credited,
    totalEarnings: cleanCode && promos[cleanCode] ? promos[cleanCode].earnings : 0,
    totalCompleted: cleanCode && promos[cleanCode] ? promos[cleanCode].completed : 0
  };
}

export async function recordManualCompleted(code, itemType = 'single') {
  const cleanCode = String(code).trim().toUpperCase();
  const promos = await getPromos();
  if (!promos[cleanCode]) {
    throw new Error(`Промокод ${cleanCode} не найден`);
  }
  const isDuo = String(itemType).toLowerCase().includes('duo') || String(itemType).toLowerCase().includes('2');
  const type = isDuo ? 'duo' : 'single';
  const commission = isDuo ? COMMISSION_DUO : COMMISSION_SINGLE;

  const p = promos[cleanCode];
  p.completed = (Number(p.completed) || 0) + 1;
  p.uses = Math.max(Number(p.uses || 0), p.completed); // Ensure uses >= completed
  if (type === 'duo') {
    p.duoCompleted = (Number(p.duoCompleted) || 0) + 1;
  } else {
    p.singleCompleted = (Number(p.singleCompleted) || 0) + 1;
  }
  p.earnings = (Number(p.singleCompleted || 0) * COMMISSION_SINGLE) + (Number(p.duoCompleted || 0) * COMMISSION_DUO);

  await savePromos(promos);

  return {
    promoCode: cleanCode,
    partnerName: p.partner,
    itemType: type,
    credited: commission,
    totalEarnings: p.earnings,
    totalCompleted: p.completed,
    singleCompleted: p.singleCompleted,
    duoCompleted: p.duoCompleted
  };
}

export async function setPromoTelegramId(code, telegramId) {
  const cleanCode = String(code).trim().toUpperCase();
  const cleanId = String(telegramId).trim();
  const promos = await getPromos();
  if (!promos[cleanCode]) {
    throw new Error(`Промокод ${cleanCode} не найден`);
  }
  promos[cleanCode].telegramId = cleanId;
  await savePromos(promos);
  return promos[cleanCode];
}

// Parses INFLUENCERS or PARTNERS environment variables
// Supported formats:
// 1. JSON: {"123456789": "MALIKA"} or {"123456789": {"code": "MALIKA", "name": "Малика"}}
// 2. String: "123456789:MALIKA, 987654321:FITNESS" or "123456789=MALIKA" or line-separated
export function parseInfluencersEnv(envStr = '') {
  const str = String(envStr || '').trim();
  if (!str) return {};

  // Try JSON
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str);
      const res = {};
      for (const [k, v] of Object.entries(parsed)) {
        const id = String(k).trim();
        if (typeof v === 'string') {
          res[id] = { code: v.trim().toUpperCase(), name: '' };
        } else if (v && typeof v === 'object') {
          res[id] = {
            code: String(v.code || v.promo || '').trim().toUpperCase(),
            name: String(v.name || v.partner || '').trim()
          };
        }
      }
      return res;
    } catch (_) {}
  }

  // Split by comma, semicolon or newline
  const entries = str.split(/[\n,;]+/);
  const map = {};
  for (const entry of entries) {
    const item = entry.trim();
    if (!item) continue;
    // Format: ID:CODE or ID=CODE or ID:CODE:NAME
    const parts = item.split(/[:=]/).map(s => s.trim());
    if (parts.length >= 2) {
      const id = parts[0];
      const code = parts[1].toUpperCase();
      const name = parts[2] || '';
      map[id] = { code, name };
    }
  }
  return map;
}

// Resolves which promo belongs to a given Telegram user ID
export async function findInfluencerPromo(telegramId, envInfluencersMap = {}) {
  const idStr = String(telegramId).trim();
  if (!idStr) return null;

  const promos = await getPromos();

  // 1. Check in env mapping
  if (envInfluencersMap[idStr]) {
    const item = envInfluencersMap[idStr];
    const code = item.code;
    const promoData = promos[code] || {
      code,
      discount: 0.10,
      partner: item.name || 'Партнер',
      uses: 0,
      completed: 0,
      singleCompleted: 0,
      duoCompleted: 0,
      earnings: 0,
      active: true
    };
    return {
      code,
      partner: item.name || promoData.partner || 'Партнер',
      promo: promoData
    };
  }

  // 2. Check in stored promos by telegramId
  for (const [code, p] of Object.entries(promos)) {
    if (p.telegramId && String(p.telegramId).trim() === idStr) {
      return {
        code,
        partner: p.partner || 'Партнер',
        promo: p
      };
    }
  }

  return null;
}
