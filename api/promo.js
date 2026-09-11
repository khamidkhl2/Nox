// Vercel Serverless Function: /api/promo
// Validates promo codes against live storage

import { getPromos } from './lib/storage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { code = '' } = req.query;
    const cleanCode = String(code).trim().toUpperCase();

    if (!cleanCode) {
      return res.status(400).json({ valid: false, message: 'Укажите промокод' });
    }

    const promos = await getPromos();
    const item = promos[cleanCode];

    if (item && item.active !== false) {
      return res.status(200).json({
        valid: true,
        code: cleanCode,
        discount: item.discount,
        partner: item.partner || 'Партнер'
      });
    }

    return res.status(404).json({
      valid: false,
      message: 'Промокод не найден или срок его действия истек'
    });
  } catch (err) {
    console.error('Promo check error:', err);
    return res.status(500).json({ valid: false, message: 'Ошибка сервера' });
  }
}
