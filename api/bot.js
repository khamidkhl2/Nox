// Vercel Serverless Function: /api/bot
// Telegram Webhook for Nox Store: Promo Code Management & Partner/Influencer Portal

import {
  getPromos,
  addPromo,
  delPromo,
  completeOrder,
  recordManualCompleted,
  setPromoTelegramId,
  parseInfluencersEnv,
  findInfluencerPromo,
  COMMISSION_SINGLE,
  COMMISSION_DUO
} from './lib/storage.js';

export default async function handler(req, res) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID).trim() : null;
  const envInfluencers = parseInfluencersEnv(process.env.INFLUENCERS || process.env.PARTNERS || '');

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
            { command: 'start', description: 'Главное меню / Панель' },
            { command: 'sleep', description: 'Гид по сну и циркадным ритмам' },
            { command: 'stats', description: 'Статистика и заработок' },
            { command: 'link', description: 'Реферальная ссылка' },
            { command: 'list', description: 'Реестр промокодов (Админ)' },
            { command: 'influencers', description: 'Список блогеров и начислений (Админ)' },
            { command: 'addpromo', description: 'Добавить промокод (Админ)' },
            { command: 'delpromo', description: 'Удалить промокод (Админ)' },
            { command: 'setinfluencer', description: 'Привязать Telegram ID к коду (Админ)' }
          ]
        })
      });

      return sendHtml(200, `
        <html><body style="font-family:sans-serif;padding:2rem;line-height:1.6;background:#FAF7EF;color:#232320;">
        <h2>✅ Telegram Webhook успешно настроен!</h2>
        <p><b>URL Webhook:</b> <code>${webhookUrl}</code></p>
        <p><b>Ответ Telegram:</b> ${hookData.description || 'OK'}</p>
        <hr style="border:0;border-top:1px solid #ccc;margin:1.5rem 0;" />
        <p>Теперь откройте Telegram и напишите боту команду <b>/start</b>.</p>
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

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'noxglasses.uz';
    const isAdmin = Boolean(adminChatId && fromId === adminChatId);

    // Resolve influencer identity
    const influencerInfo = await findInfluencerPromo(fromId, envInfluencers);
    const isInfluencer = Boolean(influencerInfo);

    // Public lead magnet: deliver Sleep Guide on /sleep, /guide, "сон", "гид", "uyqu"
    const rawIncoming = (message?.text || '').trim().toLowerCase();
    const isSleepRequest = rawIncoming === '/sleep' ||
                          rawIncoming === '/guide' ||
                          rawIncoming === 'сон' ||
                          rawIncoming === 'uyqu' ||
                          rawIncoming === 'гид' ||
                          rawIncoming === 'sleep' ||
                          rawIncoming.startsWith('сон') ||
                          rawIncoming.startsWith('uyqu');

    if (isSleepRequest) {
      await sendSleepGuide(botToken, chatId, host);
      return res.status(200).json({ ok: true });
    }

    // Security check: only admin or registered influencers are authorized for admin/dashboard actions
    if (!isAdmin && !isInfluencer) {
      await sendTg(
        botToken,
        chatId,
        `⛔ <b>Доступ ограничен</b>\n\n` +
        `Этот бот предназначен для владельца и партнеров бренда <b>Nox</b>.\n\n` +
        `• Чтобы получить бесплатный гид по сну, напишите: <code>сон</code>\n\n` +
        `• Если вы блогер или партнер проекта, передайте ваш Telegram ID менеджеру Nox:\n` +
        `🆔 <b>Ваш Telegram ID:</b> <code>${fromId}</code>`
      );
      return res.status(200).json({ ok: true });
    }

    // -------------------------------------------------------------
    // A. Handle Callback Queries (Inline button taps)
    // -------------------------------------------------------------
    if (callbackQuery) {
      const data = callbackQuery.data || '';
      const messageId = callbackQuery.message?.message_id;

      // Quick acknowledge
      if (callbackQuery.id) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id })
          });
        } catch (_) {}
      }

      // 1. Admin Order Completion Button: ord_comp:ORDER_ID:PROMO_CODE:TYPE
      if (data.startsWith('ord_comp:')) {
        if (!isAdmin) {
          await sendTg(botToken, chatId, '⛔ Только администратор может подтверждать выполнение заказов.');
          return res.status(200).json({ ok: true });
        }

        const parts = data.split(':');
        const orderId = parts[1] || '';
        const promoCode = (parts[2] === 'none' ? '' : parts[2]) || '';
        const itemType = parts[3] || 'single';

        const result = await completeOrder(orderId, promoCode, itemType);

        if (result.alreadyCompleted) {
          await sendTg(botToken, chatId, `⚠️ Заказ <b>#${orderId}</b> уже был отмечен как выполненный ранее.`);
        } else {
          const commFormatted = result.credited.toLocaleString('ru-RU') + ' сум';
          const partnerText = result.partnerName ? ` (${result.partnerName})` : (promoCode ? ` (${promoCode})` : '');
          
          let alertText = `✅ <b>Заказ #${orderId} отмечен как выполненный!</b>\n\n`;
          if (result.credited > 0) {
            alertText += `💰 Партнеру${partnerText} начислено: <b>+${commFormatted}</b>\n`;
            alertText += `📊 Всего заработано партнером: <b>${result.totalEarnings.toLocaleString('ru-RU')} сум</b> (${result.totalCompleted} зак.)`;
          } else {
            alertText += `ℹ️ Заказ без промокода (комиссия не начислялась).`;
          }

          // Edit the order card in chat to show completed status
          if (messageId && callbackQuery.message?.text) {
            const originalText = callbackQuery.message.text;
            const updatedText = `✅ <b>ВЫПОЛНЕН</b> [${new Date().toLocaleDateString('ru-RU')}]\n` +
              (result.credited > 0 ? `💰 Начислено партнеру${partnerText}: +${commFormatted}\n` : '') +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              escapeHtml(originalText);

            await editTgMessage(botToken, chatId, messageId, updatedText, [
              [{ text: `✅ Выполнен (+${commFormatted})`, callback_data: 'cb_noop' }]
            ]);
          }

          await sendTg(botToken, chatId, alertText);
        }
        return res.status(200).json({ ok: true });
      }

      // 2. Influencer callbacks
      if (isInfluencer) {
        if (data === 'inf_refresh') {
          // Re-fetch fresh promo details
          const freshInfo = await findInfluencerPromo(fromId, envInfluencers);
          await renderInfluencerDashboard(botToken, chatId, freshInfo, host, messageId);
        } else if (data === 'inf_link') {
          const link = `https://${host}/?promo=${influencerInfo.code}`;
          await sendTg(
            botToken,
            chatId,
            `🔗 <b>Ваша партнерская ссылка:</b>\n\n` +
            `<code>${link}</code>\n\n` +
            `<i>При переходе по ссылке скидка применится автоматически. Скопируйте и разместите в сторис или шапке профиля!</i>`
          );
        } else if (data === 'inf_terms') {
          const discountPct = Math.round((influencerInfo.promo.discount || 0.10) * 100);
          await sendTg(
            botToken,
            chatId,
            `ℹ️ <b>Условия партнерской программы Nox</b>\n\n` +
            `💰 <b>Размер вашей комиссии:</b>\n` +
            `• <b>${COMMISSION_SINGLE.toLocaleString('ru-RU')} сум</b> — за каждую 1 пару (The Diamond)\n` +
            `• <b>${COMMISSION_DUO.toLocaleString('ru-RU')} сум</b> — за каждый Сет из 2 пар (Для двоих)\n\n` +
            `🏷 <b>Скидка для вашей аудитории:</b> <b>${discountPct}%</b>\n\n` +
            `📦 <b>Правила начисления:</b>\n` +
            `Комиссия начисляется на ваш баланс сразу после того, как клиент получил и оплатил заказ.\n\n` +
            `💳 <b>Выплаты:</b>\n` +
            `На карты Uzcard / Humo или наличными по запросу администратору магазина.`
          );
        }
        return res.status(200).json({ ok: true });
      }

      // 3. Admin general callbacks
      if (isAdmin) {
        if (data === 'cb_list') {
          await handleListCommand(botToken, chatId, host);
        } else if (data === 'cb_influencers') {
          await handleInfluencersCommand(botToken, chatId, envInfluencers);
        } else if (data === 'cb_add_help') {
          await sendTg(
            botToken,
            chatId,
            `➕ <b>Как добавить промокод:</b>\n\n` +
            `Отправьте команду в формате:\n` +
            `<code>/addpromo КОД СКИДКА ИМЯ [TELEGRAM_ID]</code>\n\n` +
            `<b>Примеры:</b>\n` +
            `• <code>/addpromo MALIKA 10 Малика</code>\n` +
            `• <code>/addpromo FITNESS 15 Азиз 987654321</code> (с привязкой Telegram)`
          );
        } else if (data === 'cb_del_help') {
          await sendTg(
            botToken,
            chatId,
            `🗑 <b>Как удалить промокод:</b>\n\n` +
            `Отправьте:\n<code>/delpromo КОД</code>\n\n` +
            `<b>Пример:</b>\n<code>/delpromo MALIKA</code>`
          );
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: true });
    }

    // -------------------------------------------------------------
    // B. Handle Text Messages
    // -------------------------------------------------------------
    const text = (message?.text || '').trim();
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    // If user is INFLUENCER (non-admin)
    if (isInfluencer && !isAdmin) {
      if (cmd === '/link') {
        const link = `https://${host}/?promo=${influencerInfo.code}`;
        await sendTg(
          botToken,
          chatId,
          `🔗 <b>Ваша реферальная ссылка:</b>\n\n<code>${link}</code>`
        );
      } else if (cmd === '/terms' || cmd === '/help') {
        const discountPct = Math.round((influencerInfo.promo.discount || 0.10) * 100);
        await sendTg(
          botToken,
          chatId,
          `ℹ️ <b>Условия партнерской программы Nox</b>\n\n` +
          `• 1 пара: <b>${COMMISSION_SINGLE.toLocaleString('ru-RU')} сум</b>\n` +
          `• Сет из 2 пар: <b>${COMMISSION_DUO.toLocaleString('ru-RU')} сум</b>\n` +
          `• Скидка аудитории: <b>${discountPct}%</b>\n\n` +
          `Выплаты производятся после подтверждения доставки клиенту.`
        );
      } else {
        // Any other command (/start, /stats, /menu) renders their dashboard
        await renderInfluencerDashboard(botToken, chatId, influencerInfo, host);
      }
      return res.status(200).json({ ok: true });
    }

    // If user is ADMIN
    if (isAdmin) {
      if (cmd === '/start' || cmd === '/menu' || cmd === '/help') {
        await sendTgWithKeyboard(
          botToken,
          chatId,
          `🌙 <b>Панель управления Nox Business</b>\n\n` +
          `Здесь вы управляете промокодами, инфлюенсерами и начислениями комиссий.\n\n` +
          `<b>Быстрые команды:</b>\n` +
          `👥 <code>/influencers</code> — Список партнеров и заработок\n` +
          `📋 <code>/list</code> — Реестр всех промокодов\n` +
          `➕ <code>/addpromo КОД СКИДКА ИМЯ [ID]</code> — Создать промокод\n` +
          `🔗 <code>/setinfluencer КОД ID</code> — Привязать Telegram ID\n` +
          `✅ <code>/complete НОМЕР_ЗАКАЗА</code> — Отметить выполненным\n` +
          `💰 <code>/addcompleted КОД single|duo</code> — Начислить офлайн заказ\n` +
          `🗑 <code>/delpromo КОД</code> — Удалить промокод`,
          [
            [
              { text: '📋 Все промокоды', callback_data: 'cb_list' },
              { text: '👥 Партнеры / Блогеры', callback_data: 'cb_influencers' }
            ],
            [
              { text: '➕ Добавить код', callback_data: 'cb_add_help' },
              { text: '🗑 Удалить код', callback_data: 'cb_del_help' }
            ]
          ]
        );
      } else if (cmd === '/list' || cmd === '/promos') {
        await handleListCommand(botToken, chatId, host);
      } else if (cmd === '/influencers' || cmd === '/partners') {
        await handleInfluencersCommand(botToken, chatId, envInfluencers);
      } else if (cmd === '/addpromo' || cmd === '/add') {
        if (parts.length < 3) {
          await sendTg(
            botToken,
            chatId,
            `⚠️ <b>Неверный формат команды</b>\n\n` +
            `Используйте:\n<code>/addpromo КОД СКИДКА ИМЯ [TELEGRAM_ID]</code>\n\n` +
            `<b>Пример:</b>\n<code>/addpromo MALIKA 10 Малика 123456789</code>`
          );
        } else {
          const code = parts[1];
          const discount = parts[2];
          // Check if last argument looks like a Telegram numeric ID
          let partnerName = '';
          let tgId = '';
          const potentialId = parts[parts.length - 1];
          if (parts.length > 3 && /^\d{6,15}$/.test(potentialId)) {
            tgId = potentialId;
            partnerName = parts.slice(3, -1).join(' ') || 'Партнер';
          } else {
            partnerName = parts.slice(3).join(' ') || 'Партнер';
          }

          try {
            const item = await addPromo(code, discount, partnerName, tgId);
            const pct = Math.round(item.discount * 100);
            const link = `https://${host}/?promo=${item.code || code.toUpperCase()}`;

            let successMsg = `✅ <b>Промокод успешно сохранен!</b>\n\n` +
              `🏷 <b>Код:</b> <code>${code.toUpperCase()}</code>\n` +
              `💰 <b>Скидка:</b> <b>${pct}%</b>\n` +
              `👤 <b>Партнер:</b> ${escapeHtml(partnerName)}\n`;
            if (tgId) {
              successMsg += `🆔 <b>Привязан Telegram ID:</b> <code>${tgId}</code>\n`;
            }
            successMsg += `⚡ <b>Статус:</b> Активен на сайте\n\n` +
              `🔗 <b>Ссылка для блогера:</b>\n<code>${link}</code>`;

            await sendTg(botToken, chatId, successMsg);
          } catch (err) {
            await sendTg(botToken, chatId, `❌ Ошибка: ${err.message}`);
          }
        }
      } else if (cmd === '/setinfluencer' || cmd === '/linkid') {
        if (parts.length < 3) {
          await sendTg(
            botToken,
            chatId,
            `⚠️ <b>Укажите промокод и Telegram ID</b>\n\n` +
            `Пример:\n<code>/setinfluencer MALIKA 123456789</code>\n` +
            `Или с именем:\n<code>/setinfluencer MALIKA 123456789 Малика</code>`
          );
        } else {
          let code = parts[1].toUpperCase();
          let targetId = parts[2].trim();
          let partnerName = parts.slice(3).join(' ') || '';

          // Auto-swap if user entered ID first, then code: e.g. /setinfluencer 123456789 MALIKA
          if (/^\d{5,15}$/.test(code) && !/^\d+$/.test(targetId)) {
            const temp = code;
            code = targetId.toUpperCase();
            targetId = temp;
          }

          try {
            const updated = await setPromoTelegramId(code, targetId, partnerName);
            await sendTg(
              botToken,
              chatId,
              `✅ <b>Telegram ID успешно привязан!</b>\n\n` +
              `🏷 <b>Промокод:</b> <code>${code}</code>\n` +
              `👤 <b>Партнер:</b> ${escapeHtml(updated.partner)}\n` +
              `🆔 <b>Telegram ID:</b> <code>${targetId}</code>\n\n` +
              `Теперь этот блогер при открытии бота будет видеть свой персональный кабинет и заработок.`
            );
          } catch (err) {
            await sendTg(botToken, chatId, `❌ Ошибка: ${err.message}`);
          }
        }
      } else if (cmd === '/preview' || cmd === '/cabinet') {
        const targetCode = (parts[1] || 'MALIKA').toUpperCase();
        const promos = await getPromos();
        const promoData = promos[targetCode] || {
          code: targetCode,
          discount: 0.10,
          partner: 'Тест',
          uses: 0,
          completed: 0,
          singleCompleted: 0,
          duoCompleted: 0,
          earnings: 0,
          active: true
        };
        await renderInfluencerDashboard(botToken, chatId, { code: targetCode, promo: promoData, partner: promoData.partner }, host);
      } else if (cmd === '/complete' || cmd === '/done') {
        if (parts.length < 2) {
          await sendTg(
            botToken,
            chatId,
            `⚠️ <b>Укажите номер заказа</b>\n\n` +
            `Синтаксис:\n<code>/complete NOX-4912 [ПРОМОКОД] [single|duo]</code>\n\n` +
            `<i>Обычно удобнее нажимать кнопку «✅ Отметить выполненным» под уведомлением о заказе.</i>`
          );
        } else {
          const orderId = parts[1];
          const promoCode = parts[2] || '';
          const itemType = parts[3] || 'single';
          const result = await completeOrder(orderId, promoCode, itemType);
          if (result.alreadyCompleted) {
            await sendTg(botToken, chatId, `⚠️ Заказ <b>#${orderId}</b> уже был выполнен ранее.`);
          } else {
            await sendTg(
              botToken,
              chatId,
              `✅ <b>Заказ #${orderId} отмечен выполненным!</b>\n` +
              (result.credited > 0 ? `💰 Начислено партнеру (${result.partnerName || promoCode}): +${result.credited.toLocaleString('ru-RU')} сум` : '')
            );
          }
        }
      } else if (cmd === '/addcompleted') {
        if (parts.length < 2) {
          await sendTg(
            botToken,
            chatId,
            `⚠️ <b>Формат:</b> <code>/addcompleted ПРОМОКОД [single|duo]</code>\n\n` +
            `Примеры:\n` +
            `• <code>/addcompleted MALIKA single</code> (+20 000 сум)\n` +
            `• <code>/addcompleted MALIKA duo</code> (+30 000 сум)`
          );
        } else {
          const promoCode = parts[1];
          const itemType = parts[2] || 'single';
          try {
            const resData = await recordManualCompleted(promoCode, itemType);
            const comm = resData.credited.toLocaleString('ru-RU') + ' сум';
            await sendTg(
              botToken,
              chatId,
              `✅ <b>Заказ успешно начислен партнеру!</b>\n\n` +
              `👤 Партнер: <b>${escapeHtml(resData.partnerName)}</b> (${resData.promoCode})\n` +
              `📦 Комплект: <b>${itemType === 'duo' ? 'Сет из 2 пар' : '1 пара'}</b>\n` +
              `💰 Начислено: <b>+${comm}</b>\n` +
              `💵 Всего заработано: <b>${resData.totalEarnings.toLocaleString('ru-RU')} сум</b> (${resData.totalCompleted} зак.)`
            );
          } catch (e) {
            await sendTg(botToken, chatId, `❌ Ошибка: ${e.message}`);
          }
        }
      } else if (cmd === '/delpromo' || cmd === '/del') {
        if (parts.length < 2) {
          await sendTg(botToken, chatId, '⚠️ Укажите код для удаления: <code>/delpromo MALIKA</code>');
        } else {
          const code = parts[1];
          const ok = await delPromo(code);
          if (ok) {
            await sendTg(botToken, chatId, `🗑 Промокод <b>${code.toUpperCase()}</b> успешно удален.`);
          } else {
            await sendTg(botToken, chatId, `⚠️ Промокод <b>${code.toUpperCase()}</b> не найден.`);
          }
        }
      } else if (cmd === '/link') {
        if (parts.length < 2) {
          await sendTg(botToken, chatId, '⚠️ Укажите промокод: <code>/link MALIKA</code>');
        } else {
          const code = parts[1].toUpperCase();
          const link = `https://${host}/?promo=${code}`;
          await sendTg(botToken, chatId, `🔗 <b>Ссылка для промокода ${code}:</b>\n\n<code>${link}</code>`);
        }
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Bot webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}

// -------------------------------------------------------------
// View Renderers & Helpers
// -------------------------------------------------------------

async function renderInfluencerDashboard(botToken, chatId, info, host, messageIdToEdit = null) {
  const p = info.promo || {};
  const code = info.code || '';
  const partnerName = info.partner || p.partner || 'Партнер';
  const discountPct = Math.round((p.discount || 0.10) * 100);
  const uses = Number(p.uses || 0);
  const completed = Number(p.completed || 0);
  const single = Number(p.singleCompleted || 0);
  const duo = Number(p.duoCompleted || 0);
  const earnings = Number(p.earnings !== undefined ? p.earnings : ((single * COMMISSION_SINGLE) + (duo * COMMISSION_DUO)));
  const pending = Math.max(0, uses - completed);
  const link = `https://${host}/?promo=${code}`;

  let text = `🌙 <b>Партнерский кабинет Nox</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `👋 Здравствуйте, <b>${escapeHtml(partnerName)}</b>!\n\n`;
  text += `🏷 <b>Ваш промокод:</b> <code>${escapeHtml(code)}</code> (скидка <b>${discountPct}%</b>)\n`;
  text += `🔗 <b>Ваша реферальная ссылка:</b>\n<code>${link}</code>\n\n`;

  text += `📊 <b>Статистика заказов:</b>\n`;
  text += `👥 <b>Применили промокод:</b> <b>${uses}</b> чел.\n`;
  text += `📦 <b>Завершённых заказов:</b> <b>${completed}</b>\n`;
  text += `   • 1 пара (The Diamond): <b>${single}</b>\n`;
  text += `   • Сет из 2 пар (Для двоих): <b>${duo}</b>\n`;
  if (pending > 0) {
    text += `⏳ <b>В процессе доставки:</b> <b>${pending}</b> зак.\n`;
  }
  text += `\n`;

  text += `💰 <b>Ваш заработок:</b>\n`;
  text += `• За 1 пару (${COMMISSION_SINGLE.toLocaleString('ru-RU')} сум × ${single}): <b>${(single * COMMISSION_SINGLE).toLocaleString('ru-RU')} сум</b>\n`;
  text += `• За сет из 2 пар (${COMMISSION_DUO.toLocaleString('ru-RU')} сум × ${duo}): <b>${(duo * COMMISSION_DUO).toLocaleString('ru-RU')} сум</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💵 <b>ИТОГО К ВЫПЛАТЕ:</b> <b>${earnings.toLocaleString('ru-RU')} сум</b>\n\n`;
  text += `<i>Обновляется в реальном времени при подтверждении заказов магазином.</i>`;

  const keyboard = [
    [
      { text: '🔄 Обновить статистику', callback_data: 'inf_refresh' },
      { text: '🔗 Моя ссылка', callback_data: 'inf_link' }
    ],
    [
      { text: 'ℹ️ Условия и выплаты', callback_data: 'inf_terms' }
    ]
  ];

  if (messageIdToEdit) {
    await editTgMessage(botToken, chatId, messageIdToEdit, text, keyboard);
  } else {
    await sendTgWithKeyboard(botToken, chatId, text, keyboard);
  }
}

async function handleInfluencersCommand(botToken, chatId, envInfluencers) {
  const promos = await getPromos();
  const list = [];

  // 1. Gather all influencers from env
  for (const [tgId, item] of Object.entries(envInfluencers)) {
    const code = item.code;
    const p = promos[code] || {};
    list.push({
      tgId,
      code,
      name: item.name || p.partner || 'Партнер',
      uses: p.uses || 0,
      completed: p.completed || 0,
      single: p.singleCompleted || 0,
      duo: p.duoCompleted || 0,
      earnings: p.earnings || 0,
      source: 'Vercel ENV'
    });
  }

  // 2. Gather influencers stored directly with telegramId
  for (const [code, p] of Object.entries(promos)) {
    if (p.telegramId && !envInfluencers[p.telegramId]) {
      list.push({
        tgId: p.telegramId,
        code,
        name: p.partner || 'Партнер',
        uses: p.uses || 0,
        completed: p.completed || 0,
        single: p.singleCompleted || 0,
        duo: p.duoCompleted || 0,
        earnings: p.earnings || 0,
        source: 'Storage'
      });
    }
  }

  if (list.length === 0) {
    await sendTg(
      botToken,
      chatId,
      `👥 <b>Список партнеров/блогеров пуст</b>\n\n` +
      `Чтобы добавить первого блогера:\n` +
      `1. В Vercel Environment Variables добавьте <code>INFLUENCERS=ID:КОД</code>\n` +
      `2. Или прямо здесь командой:\n` +
      `<code>/setinfluencer MALIKA 123456789</code>`
    );
    return;
  }

  let text = `👥 <b>РЕЕСТР ПАРТНЕРОВ И БЛОГЕРОВ (${list.length})</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  let totalPayout = 0;

  list.forEach((inf, idx) => {
    totalPayout += (inf.earnings || 0);
    text += `${idx + 1}. 👤 <b>${escapeHtml(inf.name)}</b> (код: <code>${inf.code}</code>)\n`;
    text += `   🆔 Telegram ID: <code>${inf.tgId}</code>\n`;
    text += `   👥 Заказов с кодом: <b>${inf.uses}</b> | Завершено: <b>${inf.completed}</b>\n`;
    text += `      (1 пара: ${inf.single} шт. · Сет из 2: ${inf.duo} шт.)\n`;
    text += `   💰 Заработано: <b>${(inf.earnings || 0).toLocaleString('ru-RU')} сум</b>\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💵 <b>Общая сумма к выплате всем партнерам:</b> <b>${totalPayout.toLocaleString('ru-RU')} сум</b>\n\n`;
  text += `➕ Привязать блогера: <code>/setinfluencer КОД ID</code>\n`;
  text += `💰 Начислить офлайн заказ: <code>/addcompleted КОД single|duo</code>`;

  await sendTg(botToken, chatId, text);
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
    const completed = p.completed || 0;
    const earnings = p.earnings || 0;
    const partner = p.partner || 'Партнер';
    const tgId = p.telegramId ? ` (ID: <code>${p.telegramId}</code>)` : '';
    const link = `https://${host}/?promo=${k}`;

    text += `🏷 <b>${escapeHtml(k)}</b> — ${pct}%\n`;
    text += `👤 Партнер: <b>${escapeHtml(partner)}</b>${tgId}\n`;
    text += `📦 Заказов: <b>${uses}</b> (Выполнено: <b>${completed}</b>)\n`;
    if (earnings > 0) {
      text += `💰 Заработано: <b>${earnings.toLocaleString('ru-RU')} сум</b>\n`;
    }
    text += `🔗 <code>${link}</code>\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `➕ Добавить: <code>/addpromo КОД СКИДКА ИМЯ [ID]</code>\n`;
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

async function editTgMessage(token, chatId, messageId, text, inlineKeyboard = null) {
  try {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error('editTgMessage error:', e);
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

async function sendSleepGuide(botToken, chatId, host) {
  const guideUrl = `https://${host}/sleep`;
  const pdfUrl = `https://${host}/sleep.pdf`;
  const shopUrl = `https://${host}`;

  const text = `🌙 <b>Гид по сну и циркадным ритмам NOX</b>\n\n` +
    `<i>«Экраны стали ярче, а время отбоя не изменилось. Короткий практичный гид — не учебник. Читается за 5 минут.»</i>\n\n` +
    `⚡ <b>7 правил глубокого сна на каждый день:</b>\n` +
    `1. ☀️ <b>Яркий свет</b> в первые 30 минут утра (без очков)\n` +
    `2. ⏰ <b>Один график:</b> одинаковый подъём даже в выходные\n` +
    `3. ☕ <b>Кофеин:</b> последняя чашка строго до 14:00\n` +
    `4. 🍽 <b>Ужин:</b> за 3–4 часа до отбоя\n` +
    `5. 👓 <b>Очки Nox:</b> за 3 часа до сна (фильтрация 97.8% синего света)\n` +
    `6. ❄️ <b>Температура:</b> в спальне около 18–19 °C\n` +
    `7. 📱 <b>Экраны в сторону:</b> за 30 минут до отбоя\n\n` +
    `📖 Полная иллюстрированная версия со статьями о мелатонине, фазах сна и 3 мифах доступна на сайте и в PDF.`;

  const keyboard = [
    [
      { text: '📖 Читать гид на сайте', url: guideUrl }
    ],
    [
      { text: '📥 Скачать PDF-версию (A4)', url: pdfUrl }
    ],
    [
      { text: '👓 Заказать очки Nox The Diamond', url: shopUrl }
    ]
  ];

  await sendTgWithKeyboard(botToken, chatId, text, keyboard);
}

