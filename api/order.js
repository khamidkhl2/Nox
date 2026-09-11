// Vercel Serverless Function: /api/order
// Dispatches order notifications to Telegram Bot

import { incrementPromoUses } from './lib/storage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      orderId = 'NOX-' + Math.floor(1000 + Math.random() * 9000),
      packageName = '1 пара — The Diamond',
      price = '300 000 сум',
      promoCode = '',
      partner = '',
      discount = '',
      name = '',
      phone = '',
      address = '',
      paymentMethod = 'При получении',
      comment = '',
      lang = 'ru'
    } = data;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required.' });
    }

    const now = new Date();
    // Tashkent time UTC+5
    const tashkentTime = new Date(now.getTime() + (5 * 60 + now.getTimezoneOffset()) * 60000);
    const timeFormatted = tashkentTime.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    // Build Telegram HTML Message
    let text = `🌙 <b>НОВЫЙ ЗАКАЗ NOX</b> (#${orderId})\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📦 <b>Комплект:</b> ${escapeHtml(packageName)}\n`;
    if (promoCode) {
      text += `🏷 <b>Промокод:</b> <code>${escapeHtml(promoCode)}</code>`;
      if (partner) text += ` (${escapeHtml(partner)})`;
      if (discount) text += ` · Скидка: ${escapeHtml(discount)}`;
      text += `\n`;
    }
    text += `💰 <b>Сумма к оплате:</b> <b>${escapeHtml(price)}</b>\n\n`;
    text += `👤 <b>Клиент:</b> ${escapeHtml(name)}\n`;
    text += `📞 <b>Телефон:</b> <a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>\n`;
    text += `📍 <b>Адрес:</b> ${escapeHtml(address || 'Не указан (уточнить по телефону)')}\n`;
    text += `💳 <b>Оплата:</b> ${escapeHtml(paymentMethod)}\n`;
    if (comment) {
      text += `💬 <b>Комментарий:</b> ${escapeHtml(comment)}\n`;
    }
    text += `\n🌐 <b>Язык сайта:</b> ${String(lang).toUpperCase()}\n`;
    text += `⏱ <b>Время:</b> ${timeFormatted} (Ташкент)`;

    let telegramSent = false;
    if (botToken && chatId) {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      const tgData = await tgRes.json();
      telegramSent = Boolean(tgData.ok);
      if (!tgData.ok) {
        console.error('Telegram API error:', tgData);
      }
    } else {
      console.log('Order received (Telegram env not configured):', { orderId, name, phone, price });
    }

    if (promoCode) {
      try {
        await incrementPromoUses(promoCode);
      } catch (e) {
        console.warn('Could not increment promo uses:', e);
      }
    }

    return res.status(200).json({
      success: true,
      orderId,
      telegramDelivered: telegramSent
    });
  } catch (err) {
    console.error('Order processing error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
