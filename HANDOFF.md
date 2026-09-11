# 🌙 NOX — Project Handoff & Operations Manual

This document provides a complete overview of the **Nox** codebase, live features, deployment configuration, Telegram bot management system, and operational workflows as of **September 11, 2026**.

---

## 📌 1. Project Overview & Repository

- **Repository:** [`https://github.com/khamidkhl2/Nox.git`](https://github.com/khamidkhl2/Nox.git)
- **Primary Branch:** `main`
- **Hosting / CI/CD:** [Vercel](https://vercel.com) (connected to GitHub `main` branch, auto-deploys on push)
- **Live Domain:** `https://noxglasses.uz`
- **Git Commit Author:** `khamidkhl2 <xxolmatov@aut-edu.uz>`

---

## 🧱 2. File Structure & Architecture

```
Nox/
├── api/                             # Vercel Serverless Functions (Node.js ES Modules)
│   ├── bot.js                       # Telegram Bot Webhook & Promo Code Control Panel
│   ├── order.js                     # Order dispatch API (dispatches order cards to Telegram)
│   ├── promo.js                     # Real-time promo code validation endpoint
│   └── lib/
│       └── storage.js               # Zero-config storage engine (Telegram Pinned Msg + KV fallback)
├── website/
│   ├── index.html                   # Single-page website (HTML5, Vanilla CSS3 & JS)
│   └── images/                      # Curated product, lens, unboxing & lifestyle photography
├── vercel.json                      # Vercel routing rules (rewrites for /api and /website)
├── HANDOFF.md                       # Complete project handoff and operations manual
└── README.md
```

### Routing (`vercel.json`)
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/website/$1" }
  ]
}
```

---

## ⚙️ 3. Environment Variables (Vercel)

Set these in **Vercel Dashboard** → **Project Settings** → **Environment Variables**:

| Variable Name | Required? | Description | Example |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | **Yes** | HTTP API Bot token from [@BotFather](https://t.me/BotFather) | `7981234567:AAH...` |
| `TELEGRAM_CHAT_ID` | **Yes** | Numeric Chat ID of the store owner or admin group | `567812345` or `-100...` |
| `INFLUENCERS` | **Recommended** | Influencer Telegram IDs mapped to promo codes | `123456789:MALIKA, 987654321:FITNESS` |
| `KV_REST_API_URL` | *Optional* | Vercel KV Redis REST URL (if using Upstash/KV) | `https://...upstash.io` |
| `KV_REST_API_TOKEN`| *Optional* | Vercel KV Redis REST Bearer Token | `AX12...` |

> [!TIP]
> **How to add Influencer Telegram IDs in Vercel:**
> - Set `INFLUENCERS` = `USER_ID:PROMOCODE` (e.g. `123456789:MALIKA`).
> - For multiple influencers, separate by comma: `123456789:MALIKA, 987654321:FITNESS`.
> - Alternatively, paste JSON: `{"123456789": "MALIKA"}`.
> - Or link on the fly via the Telegram bot command: `/setinfluencer MALIKA 123456789`.

---

## 🤖 4. Telegram Bot Promo Code & Influencer Partner System

### One-Click Webhook Activation
After deploying to Vercel, activate the Telegram webhook with a single click:
👉 **`https://noxglasses.uz/api/bot?setup=1`**

This registers the webhook with Telegram (`setWebhook`) and installs the command menu in Telegram (`setMyCommands`).

### ✨ Influencer Experience (Personalized Dashboard)
When a registered influencer opens `@noxbusinessbot` and presses `/start`:
1. **Personalized Greeting:** Recognizes them by their Telegram user ID.
2. **Attribution & Referral Link:** Shows their unique promo code (e.g. `MALIKA` - 10% off) and clickable referral link (`https://noxglasses.uz/?promo=MALIKA`).
3. **Usage vs Completed Orders:**
   - **Применили промокод:** Total people who applied their code and placed an order.
   - **Завершённых заказов:** Completed / delivered orders confirmed by the store.
   - **Breakdown:** Number of 1-pair orders vs Set of 2 orders.
   - **В процессе доставки:** Orders currently pending fulfillment.
4. **Accrued Earnings (Commission):**
   - **20 000 сум** per completed 1-pair order (The Diamond)
   - **30 000 сум** per completed Set of 2 (Для двоих)
   - **ИТОГО К ВЫПЛАТЕ:** Total calculated earnings in UZS.
5. **Interactive Buttons:** `[ 🔄 Обновить статистику ]`, `[ 🔗 Моя ссылка ]`, `[ ℹ️ Условия и выплаты ]`.

### 🛡 Admin Commands & Order Completion Workflow
The store owner (`TELEGRAM_CHAT_ID`) has full management tools:

| Command | Description | Example Syntax |
| :--- | :--- | :--- |
| **`/start`** or **`/menu`** | Admin control panel with quick action buttons | `/start` |
| **`/influencers`** | Overview of all registered partners, their orders, and payout balances | `/influencers` |
| **`/list`** | Lists all promo codes, discounts, usage, and completions | `/list` |
| **`/addpromo`** | Creates or updates a promo code (optionally with Telegram ID) | `/addpromo MALIKA 10 Малика 123456789` |
| **`/setinfluencer`**| Links an influencer's Telegram ID to an existing promo code | `/setinfluencer MALIKA 123456789` |
| **`/complete`** | Manually marks an order as completed | `/complete NOX-4912 MALIKA single` |
| **`/addcompleted`**| Credits an offline or Instagram DM order to an influencer | `/addcompleted MALIKA duo` |
| **`/delpromo`** | Deactivates or removes a promo code | `/delpromo MALIKA` |
| **`/link`** | Generates shareable referral link for a promo code | `/link MALIKA` |

#### One-Click Order Completion:
When a new order notification arrives in your Telegram chat:
- An inline button is attached: `[ ✅ Отметить выполненным (+20 000 сум блогеру) ]`
- Tapping the button immediately marks the order as fulfilled, credits the influencer, prevents duplicate counting, and updates the message card in your chat.

### 🔎 Auto-Discovery for Unregistered Users:
If a partner messages the bot before being registered, the bot replies with their exact numeric Telegram user ID in copyable form:
> 🆔 **Ваш Telegram ID:** `123456789`
The partner can tap to copy and send it to you.

---

## 🌐 5. Website Features & Sections (`website/index.html`)

### A. First-Time Visitor Language Selection Modal
- Appears only on the visitor's very first visit.
- Allows choice between **Русский**, **O'zbekcha**, and **English**.
- Selection is saved to `localStorage.getItem('nox_lang_selected')`. Future visits remember the preference.

### B. Product & Pricing Section (`#product`)
- **1 пара — The Diamond:** `300 000 сум` (standard single pack).
- **Сет из 2 пар (Для двоих):** `550 000 сум` (with `ВЫГОДА 50 000 СУМ` floating badge).
- Package cards have balanced, identical heights.
- Removed outdated text ("хит продаж", "примерка перед оплатой", "мужчина, девушка") and replaced with subtle return policy reassurance ("есть возможность возврата" / "qaytarish imkoniyati bor").
- Image crops adjusted to keep frames and faces centered without awkward head cropping.

### C. Checkout Methods (Dual Action)
1. **Direct Web Order Modal (`#order-modal`):**
   - Package switcher (1 pair vs 2 pairs)
   - Dynamic price calculation with live promo code discount
   - Customer name, phone auto-format (`+998`), delivery address
   - Payment method (Click / Payme vs Cash)
   - Dispatches order payload to `POST /api/order`
2. **Pre-filled Telegram Link (`#tg-order-link`):**
   - For customers who prefer chatting first.
   - Pre-fills language-specific order text directly into `@noxglasses` with chosen package, price, and active promo code.

### D. Conversion & Trust Sections
- **"Что в комплекте" / Unboxing (`#unboxing`):** 4-card breakdown (sunglasses, matte case, microfibre cloth, Sleep Protocol PDF).
- **Circadian Spectrum Simulator (`#simulator`):** Interactive day vs night blue-light spectrum filter demo.
- **Tashkent Wear-Tester Reviews (`#reviews`):** Authentic testimonials from local Tashkent professionals.
- **Local Trust Bar:** Yandex Go delivery (1–2 hours), Click, Payme, Cash on delivery.
- **Sticky Mobile Quick-Order Bar:** Stays docked at the bottom on mobile devices.
- **Interactive Sleep Guide (`/sleep` & `/guide`):** Dedicated mobile-first web reader for circadian sleep hygiene.
- **Downloadable Sleep Guide PDF (`/sleep.pdf` & `/nox-sleep-guide-ru.pdf`):** 4-page publication-grade PDF matching the brand's luxury aesthetic.
- **Telegram Bot Lead Magnet:** Automatically delivers the 7-rule summary, web reader link, and PDF download when users type `сон`, `uyqu`, `гид`, or `/sleep`.

---

## 📡 6. API Reference

### 1. `POST /api/order`
Processes incoming web checkout orders and sends a Telegram notification.
- **Request Body:**
  ```json
  {
    "orderId": "NOX-4912",
    "packageName": "Сет из 2 пар (Для двоих)",
    "price": "550 000 сум",
    "promoCode": "MALIKA",
    "name": "Азиз Каримов",
    "phone": "+998 90 123 45 67",
    "address": "Ташкент, Мирзо-Улугбекский р-н, ул. Мустакиллик 12",
    "paymentMethod": "Click / Payme",
    "lang": "ru"
  }
  ```
- **Response:** `{ "success": true, "orderId": "NOX-4912" }`
- **Side-Effects:** Sends formatted HTML alert to `TELEGRAM_CHAT_ID` and increments promo usage counter.

### 2. `GET /api/promo?code=XXX`
Validates promo codes live against the persistent storage.
- **Query Params:** `code` (string, case-insensitive)
- **Success Response (200):**
  ```json
  {
    "valid": true,
    "code": "MALIKA",
    "discount": 0.15,
    "partner": "Малика Блогер"
  }
  ```
- **Error Response (404):**
  ```json
  {
    "valid": false,
    "message": "Промокод не найден или срок его действия истек"
  }
  ```

### 3. `GET /api/bot?setup=1` & `POST /api/bot`
- **`GET /api/bot?setup=1`:** Registers Telegram webhook and bot command menu.
- **`POST /api/bot`:** Receives and executes incoming Telegram updates and commands.

---

## 🧪 7. Local Testing & Verification

Run these verification tests anytime in your terminal:

```bash
# Test API modules and imports
node -e "
import('./api/lib/storage.js');
import('./api/promo.js');
import('./api/bot.js');
import('./api/order.js');
console.log('All API modules valid!');
"

# Test Promo Code Storage CRUD & Counter
node -e "
import('./api/lib/storage.js').then(async ({ getPromos, addPromo, incrementPromoUses, delPromo }) => {
  await addPromo('TESTCODE', 10, 'Tester');
  await incrementPromoUses('TESTCODE');
  let p = await getPromos();
  console.log('Test promo added & incremented:', p['TESTCODE']);
  await delPromo('TESTCODE');
  console.log('Test promo cleaned up.');
});
"
```

---

## 🚀 8. Quick Launch Checklist

1. [x] Push code to GitHub `main` branch.
2. [x] Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Vercel Environment Variables.
3. [ ] Open `https://noxglasses.uz/api/bot?setup=1` in your browser once to activate the bot.
4. [ ] Open your bot in Telegram, type `/start`, and verify the command buttons appear.
5. [ ] Create your first influencer promo code via `/addpromo CODE 15 PartnerName`.
6. [ ] Share the generated link `https://noxglasses.uz/?promo=CODE` with your partner.
