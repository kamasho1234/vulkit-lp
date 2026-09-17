"use strict";

const crypto = require("node:crypto");

const PRODUCT = "VULKIT VB108";
const VERSION = "vb108-v1";
const SITE_URL = "https://vulkit.kamacrafy.com";
const UNIT_PRICE = 6810;
const REGULAR_PRICE = 8620;
const COLORS = Object.freeze({
  greige: { label: "グレージュ", sku: "VB108-GREIGE", image: "vb108-greige.jpg" },
  caramel: { label: "モカブラウン", sku: "VB108-CARAMEL", image: "vb108-caramel-brown.jpg" },
  black: { label: "黒", sku: "VB108-BLACK", image: "vb108-black-v129.jpg" }
});

class CommerceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function normalizeItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > Object.keys(COLORS).length) {
    throw new CommerceError(400, "カートの内容を確認してください。");
  }
  const seen = new Set();
  const items = raw.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.color !== "string" || !Object.hasOwn(COLORS, item.color) ||
        seen.has(item.color) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 5) {
      throw new CommerceError(400, "カラーと数量を確認してください。同じカラーは5点までです。");
    }
    seen.add(item.color);
    return { color: item.color, quantity: item.quantity };
  });
  return items.sort((a, b) => Object.keys(COLORS).indexOf(a.color) - Object.keys(COLORS).indexOf(b.color));
}

function priceCart(raw) {
  const items = normalizeItems(raw).map(item => ({ ...item, label: COLORS[item.color].label,
    unitPrice: UNIT_PRICE, subtotal: UNIT_PRICE * item.quantity }));
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = UNIT_PRICE * itemCount;
  const shipping = itemCount >= 2 ? 0 : 350;
  return { items, itemCount, subtotal, shipping, total: subtotal + shipping, currency: "JPY" };
}

function text(value, max, field, required = true) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    if (!required && (value === undefined || value === null || value === "")) return "";
    throw new CommerceError(400, `${field}を確認してください。`);
  }
  const result = value.normalize("NFKC").trim();
  if (required && !result) throw new CommerceError(400, `${field}を入力してください。`);
  return result;
}

function normalizeCustomer(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CommerceError(400, "配送先を入力してください。");
  const name = text(raw.name, 120, "お名前");
  const email = text(raw.email, 180, "メールアドレス").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new CommerceError(400, "メールアドレスを確認してください。");
  const phoneRaw = text(raw.phone, 40, "電話番号").replace(/[\s()（）−ー‐-]/g, "");
  let digits = phoneRaw;
  if (/^\+81/.test(digits)) digits = "0" + digits.slice(3);
  if (!/^0\d{9,10}$/.test(digits)) throw new CommerceError(400, "電話番号は10〜11桁で入力してください。");
  const address = raw.address;
  if (!address || typeof address !== "object" || Array.isArray(address) || (address.country && address.country !== "JP")) {
    throw new CommerceError(400, "配送先は日本国内の住所を入力してください。");
  }
  const postal = text(address.postal_code, 12, "郵便番号").replace(/[\s-]/g, "");
  if (!/^\d{7}$/.test(postal)) throw new CommerceError(400, "郵便番号は7桁で入力してください。");
  const full = text(raw.address_full, 350, "住所");
  const prefecture = full.match(/^(北海道|東京都|京都府|大阪府|.{2,3}県)/)?.[1];
  const validPrefectures = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
  if (!validPrefectures.includes(prefecture)) throw new CommerceError(400, "住所は都道府県から入力してください。");
  const rest = full.slice(prefecture.length).trim();
  const city = text(address.city, 100, "市区町村");
  if (!rest.startsWith(city) || city.length >= rest.length || !/[市区町村]$/.test(city)) {
    throw new CommerceError(400, "住所の市区町村・町名・番地を確認してください。");
  }
  const line1 = rest.slice(city.length).trim();
  if (line1.length < 2 || line1.length > 180) throw new CommerceError(400, "住所の町名・番地を確認してください。");
  return { name, email, phone: "+81" + digits.slice(1), address: { country: "JP", postal_code: postal,
    state: prefecture, city, line1, line2: text(address.line2, 180, "建物名・部屋番号", false) } };
}

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    throw new CommerceError(415, "送信形式を確認してください。");
  }
  if (Number(req.headers["content-length"]) > 16000) throw new CommerceError(413, "入力内容が長すぎます。");
  let raw;
  if (req.body !== undefined) {
    raw = typeof req.body === "string" || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body);
  } else {
    raw = await new Promise((resolve, reject) => {
      let data = "", tooLarge = false;
      req.on("data", chunk => {
        if (tooLarge) return;
        data += chunk;
        if (Buffer.byteLength(data) > 16000) { tooLarge = true; reject(new CommerceError(413, "入力内容が長すぎます。")); }
      });
      req.on("end", () => { if (!tooLarge) resolve(data); });
      req.on("error", reject);
    });
  }
  if (Buffer.byteLength(raw || "") > 16000) throw new CommerceError(413, "入力内容が長すぎます。");
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new CommerceError(400, "入力内容を確認してください。"); }
}

function assertOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set([SITE_URL]);
  const host = String(req.headers.host || "");
  if (/^[a-z0-9.-]+\.vercel\.app$/i.test(host)) allowed.add(`https://${host}`);
  if (/^localhost:\d+$/.test(host)) allowed.add(`http://${host}`);
  if (!allowed.has(origin)) throw new CommerceError(403, "商品ページからお手続きをやり直してください。");
}

function assertConfigured() {
  // Do not accept payments unless signed fulfillment and order notifications are configured too.
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"]) {
    if (!process.env[key]) throw new CommerceError(503, "ただいま決済を開始できません。時間をおいてお試しください。");
  }
}

async function stripeRequest(path, { method = "GET", params, idempotencyKey } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new CommerceError(503, "ただいま決済を確認できません。時間をおいてお試しください。");
  const headers = { Authorization: `Bearer ${secret}` };
  if (params) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers, body: params?.toString(), signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 404) throw new CommerceError(404, "決済情報が見つかりません。リンクをご確認ください。");
    if (response.status === 409 || response.status === 429) throw new CommerceError(429, "少し時間をおいてから再度お試しください。");
    throw new CommerceError(502, "決済サービスに接続できませんでした。時間をおいて再度お試しください。");
  }
  return data;
}

function appendAddress(params, prefix, address) {
  for (const [key, value] of Object.entries(address)) if (value) params.append(`${prefix}[${key}]`, value);
}

async function createCheckout(body) {
  if (body.color_label_version !== undefined && body.color_label_version !== "vb108-color-v108") throw new CommerceError(400, "決済画面を再読み込みしてください。");
  const items = normalizeItems(body.items);
  const pricing = priceCart(items);
  const customer = normalizeCustomer(body.customer);
  if (typeof body.attempt_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.attempt_id)) {
    throw new CommerceError(400, "決済画面を再読み込みして、もう一度お試しください。");
  }
  assertConfigured();
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ items, customer })).digest("hex");
  const key = `${body.attempt_id}:${fingerprint}`;
  const customerParams = new URLSearchParams({ name: customer.name, email: customer.email, phone: customer.phone,
    "shipping[name]": customer.name, "shipping[phone]": customer.phone, "metadata[product]": PRODUCT });
  appendAddress(customerParams, "address", customer.address);
  appendAddress(customerParams, "shipping[address]", customer.address);
  const stripeCustomer = await stripeRequest("customers", { method: "POST", params: customerParams, idempotencyKey: `vb108-customer:${key}` });
  if (!/^cus_[a-zA-Z0-9]+$/.test(stripeCustomer.id || "")) throw new CommerceError(502, "決済を開始できませんでした。再度お試しください。");
  const cancelQuery = new URLSearchParams({ cancelled: "1" });
  items.forEach(item => cancelQuery.set(item.color, String(item.quantity)));
  const params = new URLSearchParams({
    mode: "payment", locale: "ja", customer: stripeCustomer.id,
    success_url: `${SITE_URL}/VB108/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/VB108/checkout.html?${cancelQuery}`,
    "customer_update[name]": "auto", "customer_update[address]": "auto", "customer_update[shipping]": "auto",
    billing_address_collection: "auto", "phone_number_collection[enabled]": "true",
    "shipping_address_collection[allowed_countries][0]": "JP",
    "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
    "shipping_options[0][shipping_rate_data][fixed_amount][amount]": String(pricing.shipping),
    "shipping_options[0][shipping_rate_data][fixed_amount][currency]": "jpy",
    "shipping_options[0][shipping_rate_data][display_name]": pricing.shipping ? "送料" : "2点以上のご購入で送料無料"
  });
  items.forEach((item, index) => {
    const prefix = `line_items[${index}]`, color = COLORS[item.color];
    params.set(`${prefix}[quantity]`, String(item.quantity));
    params.set(`${prefix}[price_data][currency]`, "jpy");
    params.set(`${prefix}[price_data][unit_amount]`, String(UNIT_PRICE));
    params.set(`${prefix}[price_data][tax_behavior]`, "inclusive");
    // Old open checkout pages keep the exact Stripe retry payload for their existing attempt ID.
    const displayLabel = item.color === "caramel" && !body.color_label_version ? "キャラメルブラウン" : color.label;
    params.set(`${prefix}[price_data][product_data][name]`, `${PRODUCT} セキュリティポーチ（${displayLabel}）`);
    params.set(`${prefix}[price_data][product_data][description]`, "新規OPENキャンペーン21%OFF：定価8,620円（税込）→6,810円（税込）");
    params.set(`${prefix}[price_data][product_data][images][0]`, `${SITE_URL}/VB108/assets/${color.image}`);
    params.set(`${prefix}[price_data][product_data][metadata][color]`, item.color);
    params.set(`${prefix}[price_data][product_data][metadata][sku]`, color.sku);
  });
  const metadata = { product: PRODUCT, checkout_version: VERSION, cart: JSON.stringify(items),
    quantity: String(pricing.itemCount), subtotal: String(pricing.subtotal), shipping: String(pricing.shipping),
    charged_amount: String(pricing.total), regular_amount: String(REGULAR_PRICE * pricing.itemCount), purchase_mode: "shipping" };
  for (const [name, value] of Object.entries(metadata)) {
    params.set(`metadata[${name}]`, value);
    params.set(`payment_intent_data[metadata][${name}]`, value);
  }
  const session = await stripeRequest("checkout/sessions", { method: "POST", params, idempotencyKey: `vb108-session:${key}` });
  let url;
  try { url = new URL(session.url); } catch { throw new CommerceError(502, "決済画面を開けませんでした。再度お試しください。"); }
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port) {
    throw new CommerceError(502, "決済画面を開けませんでした。再度お試しください。");
  }
  // Checkout may not have selected its single shipping option at creation time.
  // Fulfillment always verifies the final, shipping-inclusive total separately.
  const shippingNotSelected = session.shipping_cost == null && session.amount_total === pricing.subtotal;
  if (session.amount_subtotal !== pricing.subtotal || session.currency !== "jpy" ||
      (session.amount_total !== pricing.total && !shippingNotSelected)) {
    throw new CommerceError(502, "決済金額を確認できませんでした。再度お試しください。");
  }
  return { ok: true, id: session.id, url: session.url, value: pricing.total, currency: "JPY" };
}

async function getStripeSession(sessionId) {
  if (typeof sessionId !== "string" || !/^cs_(?:live|test)_[a-zA-Z0-9]{16,200}$/.test(sessionId)) {
    throw new CommerceError(400, "決済情報のリンクを確認してください。");
  }
  return stripeRequest(`checkout/sessions/${sessionId}?expand%5B%5D=line_items.data.price.product`);
}

function verifySession(session) {
  const invalid = () => { throw new CommerceError(409, "決済内容を確認できませんでした。お問い合わせください。"); };
  if (!session || session.metadata?.product !== PRODUCT || session.metadata?.checkout_version !== VERSION || session.mode !== "payment") return invalid();
  let items;
  try { items = normalizeItems(JSON.parse(session.metadata.cart)); } catch { return invalid(); }
  const summary = priceCart(items);
  if (session.currency !== "jpy" || session.amount_subtotal !== summary.subtotal || session.amount_total !== summary.total ||
      session.total_details?.amount_shipping !== summary.shipping || Number(session.total_details?.amount_discount || 0) !== 0) return invalid();
  const lines = session.line_items?.data;
  if (!Array.isArray(lines) || session.line_items.has_more || lines.length !== items.length) return invalid();
  const seen = new Set();
  for (const line of lines) {
    const price = line.price, color = price?.product?.metadata?.color;
    const expected = items.find(item => item.color === color);
    if (!expected || seen.has(color) || line.quantity !== expected.quantity || price.currency !== "jpy" ||
        price.unit_amount !== UNIT_PRICE || price.product.metadata.sku !== COLORS[color].sku ||
        line.amount_subtotal !== UNIT_PRICE * expected.quantity || line.amount_total !== UNIT_PRICE * expected.quantity) return invalid();
    seen.add(color);
  }
  if (session.livemode !== undefined && process.env.STRIPE_SECRET_KEY) {
    const liveKey = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY);
    if (Boolean(session.livemode) !== liveKey) return invalid();
  }
  const status = session.payment_status === "paid" && session.status === "complete" ? "paid"
    : session.status === "complete" && session.payment_status === "unpaid" ? "pending" : "unpaid";
  const orderReference = `VB108-${crypto.createHash("sha256").update(session.id).digest("hex").slice(0, 12).toUpperCase()}`;
  return { ...summary, status, orderReference };
}

module.exports = { PRODUCT, VERSION, SITE_URL, COLORS, UNIT_PRICE, REGULAR_PRICE, CommerceError,
  normalizeItems, normalizeCustomer, priceCart, send, readBody, assertOrigin, createCheckout, getStripeSession, verifySession };
