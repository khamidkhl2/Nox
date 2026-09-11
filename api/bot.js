// Vercel Serverless Function: /api/bot
// Telegram Webhook for managing Nox store and promo codes

import { getPromos, addPromo, delPromo } from './lib/storage.js';

export default async function handler(req, res) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID).trim() : null;

  const sendHtml = (status, html) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(status);
    if (typeof res.send === 'function') return res.send(html);
    return res.end(html);
  };

  // 1. One-click Webhook Setup via GET /api/bot?setup=1
  if (req.method === 'GET') {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'noxglasses.uz';
    const webhookUrl = `https://${host}/api/bot`;

    if (!botToken) {
      return sendHtml(400, `
        <html><body style="font-family:sans-serif;padding:2rem;">
        <h2>❌ TELEGRAM_BOT_TOKEN не задан в Vercel</h2>
        <p>Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в Settings -> Environment Variables и сделайте Redeploy.</p>
        </body></html>
      `);
    }

    try {
      // Set Webhook
      const setHookRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const hookData = await setHookRes.json();

      // Set Bot Commands Menu
      await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Панель управления промокодами' },
            { command: 'list', description: 'Список всех промокодов' },
            { command: 'addpromo', description: 'Добавить промокод: /addpromo КОД СКИДКА ИМЯ' },
            { command: 'delpromo', description: 'Удалить промокод: /delpromo КОД' },
            { command: 'link', description: 'Ссылка для блогера: /link КОД' }
          ]
        })
      });

      return sendHtml(200, `
        <html><body style="font-family:sans-serif;padding:2rem;line-height:1.6;background:#FAF7EF;color:#232320;">
        <h2>✅ Telegram Webhook успешно настроен!</h2>
        <p><b>URL Webhook:</b> <code>${webhookUrl}</code></p>
        <p><b>Ответ Telegram:</b> ${hookData.description || 'OK'}</p>
        <hr style="border:0;border-top:1px solid #ccc;margin:1.5rem 0;" />
        <p>Теперь откройте Telegram и напишите боту команду <b>/start</b> или <b>/list</b>.</p>
        </body></html>
      `);
    } catch (err) {
      return sendHtml(500, `Ошибка настройки webhook: ${err.message}`);
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // 2. Handle Incoming Telegram Updates
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = update.message;
    const callbackQuery = update.callback_query;

    const fromId = String(message?.from?.id || callbackQuery?.from?.id || '');
    const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;

    if (!chatId || !botToken) {
      return res.status(200).json({ ok: true });
    }

    // Security check: Only the store owner is allowed
    if (adminChatId && fromId !== adminChatId) {
      await sendTg(botToken, chatId, '⛔ <b>Доступ ограничен</b>\nЭтот бот предназначен только для владельца магазина Nox.');
      return res.status(200).json({ ok: true });
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'noxglasses.uz';

    // Handle Callback Query (inline button clicks)
    if (callbackQuery) {
      if (callbackQuery.id) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id })
          });
        } catch (_) {}
      }

      const data = callbackQuery.data;
      if (data === 'cb_list') {
        await handleListCommand(botToken, chatId, host);
      } else if (data === 'cb_add_help') {
        await sendTg(botToken, chatId, 
          `➕ <b>Как добавить промокод:</b>\n\n` +
          `Отправьте сообщение в формате:\n` +
          `<code>/addpromo КОД СКИДКА ИМЯ</code>\n\n` +
          `<b>Примеры:</b>\n` +
          `• <code>/addpromo MALIKA 10 Малика</code> (10% скидка)\n` +
          `• <code>/addpromo FITNESS 15 Азиз Спорт</code> (15% скидка)\n` +
          `• <code>/addpromo SPECIAL 20 VIP</code> (20% скидка)`
        );
      } else if (data === 'cb_del_help') {
        await sendTg(botToken, chatId,
          `🗑 <b>Как удалить промокод:</b>\n\n` +
          `Отправьте:\n` +
          `<code>/delpromo КОД</code>\n\n` +
          `<b>Пример:</b>\n` +
          `<code>/delpromo MALIKA</code>`
        );
      }
      return res.status(200).json({ ok: true });
    }

    // Handle Text Messages
    const text = (message?.text || '').trim();
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/start' || cmd === '/menu' || cmd === '/help' || cmd === '/promo') {
      await sendTgWithKeyboard(botToken, chatId,
        `🌙 <b>Панель управления промокодами Nox</b>\n\n` +
        `Здесь вы можете мгновенно создавать, проверять и удалять промокоды для инфлюенсеров и партнеров.\n\n` +
        `<b>Быстрые команды:</b>\n` +
        `➕ <code>/addpromo КОД СКИДКА ИМЯ</code>\n` +
        `📋 <code>/list</code> — Список всех промокодов\n` +
        `🗑 <code>/delpromo КОД</code> — Удалить промокод\n` +
        `🔗 <code>/link КОД</code> — Ссылка для блогера`,
        [
          [
            { text: '📋 Список промокодов', callback_data: 'cb_list' },
            { text: '➕ Добавить промокод', callback_data: 'cb_add_help' }
          ],
          [
            { text: '🗑 Инструкция удаления', callback_data: 'cb_del_help' }
          ]
        ]
      );
    } else if (cmd === '/list' || cmd === '/promos') {
      await handleListCommand(botToken, chatId, host);
    } else if (cmd === '/addpromo' || cmd === '/add') {
      if (parts.length < 3) {
        await sendTg(botToken, chatId,
          `⚠️ <b>Неверный формат команды</b>\n\n` +
          `Используйте:\n<code>/addpromo КОД СКИДКА ИМЯ</code>\n\n` +
          `<b>Пример:</b>\n<code>/addpromo MALIKA 10 Малика</code>`
        );
      } else {
        const code = parts[1];
        const discount = parts[2];
        const partner = parts.slice(3).join(' ') || 'Партнер';

        try {
          const item = await addPromo(code, discount, partner);
          const pct = Math.round(item.discount * 100);
          const link = `https://${host}/?promo=${item.code || code.toUpperCase()}`;

          await sendTg(botToken, chatId,
            `✅ <b>Промокод успешно сохранен!</b>\n\n` +
            `🏷 <b>Код:</b> <code>${code.toUpperCase()}</code>\n` +
            `💰 <b>Скидка:</b> <b>${pct}%</b>\n` +
            `👤 <b>Партнер:</b> ${escapeHtml(partner)}\n` +
            `⚡ <b>Статус:</b> Активен на сайте\n\n` +
            `🔗 <b>Ссылка для подписчиков блогера:</b>\n` +
            `<code>${link}</code>\n\n` +
            `<i>При переходе по ссылке скидка применится автоматически!</i>`
          );
        } catch (err) {
          await sendTg(botToken, chatId, `❌ Ошибка: ${err.message}`);
        }
      }
    } else if (cmd === '/delpromo' || cmd === '/del') {
      if (parts.length < 2) {
        await sendTg(botToken, chatId,
          `⚠️ <b>Укажите код для удаления</b>\n\n` +
          `Пример: <code>/delpromo MALIKA</code>`
        );
      } else {
        const code = parts[1];
        const ok = await delPromo(code);
        if (ok) {
          await sendTg(botToken, chatId, `🗑 Промокод <b>${code.toUpperCase()}</b> успешно удален и деактивирован на сайте.`);
        } else {
          await sendTg(botToken, chatId, `⚠️ Промокод <b>${code.toUpperCase()}</b> не найден в списке.`);
        }
      }
    } else if (cmd === '/link') {
      if (parts.length < 2) {
        await sendTg(botToken, chatId, '⚠️ Укажите промокод: <code>/link MALIKA</code>');
      } else {
        const code = parts[1].toUpperCase();
        const link = `https://${host}/?promo=${code}`;
        await sendTg(botToken, chatId,
          `🔗 <b>Ссылка для промокода ${code}:</b>\n\n` +
          `<code>${link}</code>`
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Bot webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}

async function handleListCommand(botToken, chatId, host) {
  const promos = await getPromos();
  const keys = Object.keys(promos);

  if (keys.length === 0) {
    await sendTg(botToken, chatId, '📋 В базе пока нет активных промокодов.\nДобавьте первый: <code>/addpromo MALIKA 10 Малика</code>');
    return;
  }

  let text = `📋 <b>РЕЕСТР ПРОМОКОДОВ NOX (${keys.length})</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  keys.forEach((k) => {
    const p = promos[k];
    const pct = Math.round((p.discount || 0) * 100);
    const uses = p.uses || 0;
    const partner = p.partner || 'Партнер';
    const link = `https://${host}/?promo=${k}`;

    text += `🏷 <b>${escapeHtml(k)}</b> — ${pct}%\n`;
    text += `👤 Партнер: <b>${escapeHtml(partner)}</b>\n`;
    text += `📦 Оформлено заказов: <b>${uses}</b>\n`;
    text += `🔗 <code>${link}</code>\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `➕ Добавить: <code>/addpromo КОД СКИДКА ИМЯ</code>\n`;
  text += `🗑 Удалить: <code>/delpromo КОД</code>`;

  await sendTg(botToken, chatId, text);
}

async function sendTg(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error('sendTg error:', e);
  }
}

async function sendTgWithKeyboard(token, chatId, text, inlineKeyboard) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      })
    });
  } catch (e) {
    console.error('sendTgWithKeyboard error:', e);
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
