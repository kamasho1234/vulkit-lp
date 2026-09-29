"use strict";

const crypto = require("node:crypto");

const PRODUCT = "VULKIT VB108";
const ADMIN_EMAIL = "ikemen@kamacrafy.com";
const SUPPORTED_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const SIGNATURE_TOLERANCE_SECONDS = 300;
// Resend retains idempotency keys for 24 hours. Stop uncertain retries earlier;
// an administrator must reconcile a delivery whose sent marker could not persist.
const SAFE_DELIVERY_RETRY_MS = 23 * 60 * 60 * 1000;
const LEGACY_EMAIL_VERSION = "vb108-confirmation-v1";
const PREVIOUS_EMAIL_VERSION = "vb108-confirmation-v2";
const PREVIOUS_V3_EMAIL_VERSION = "vb108-confirmation-v3";
const PREVIOUS_V4_EMAIL_VERSION = "vb108-confirmation-v4";
const EMAIL_VERSION = "vb108-confirmation-v5";
const DEFAULT_LINE_URL = "https://lin.ee/6xr7cz7";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";
const money = (amount) => `${amount.toLocaleString("ja-JP")}円`;
const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const failure = (code) => Object.assign(new Error(code), { code });
const response = (statusCode, body) => ({ statusCode, body });

function verifyVB108Signature(rawBody, header, secret, nowMs = Date.now()) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof header !== "string") return false;
  const components = header.split(",").map((part) => part.trim().split("="));
  const timestamps = components.filter(([key]) => key === "t").map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0] || "")) return false;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowMs / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamps[0]}.`).update(rawBody).digest();
  return components.some(([key, value]) => key === "v1" && /^[a-fA-F0-9]{64}$/.test(value || "") &&
    crypto.timingSafeEqual(Buffer.from(value, "hex"), expected));
}

function customerDetails(session) {
  const shipping = session.collected_information?.shipping_details || session.shipping_details || {};
  const customer = session.customer_details || {};
  const address = shipping.address || customer.address || {};
  return {
    name: clean(shipping.name || customer.name, 120),
    email: clean(customer.email || session.customer_email, 254).toLowerCase(),
    phone: clean(shipping.phone || customer.phone, 80),
    address: [
      address.postal_code ? `〒${clean(address.postal_code, 30)}` : "",
      clean(address.state, 100), clean(address.city, 100), clean(address.line1, 180), clean(address.line2, 180),
    ].filter(Boolean).join(" "),
  };
}

function notificationText(role, summary, customer, sessionId, replyTo) {
  const items = summary.items.map((item) => `${item.label} × ${item.quantity}点　${money(item.subtotal)}`);
  const common = [
    PRODUCT,
    `ご注文番号：${summary.orderReference}`,
    "",
    ...items,
    `商品小計：${money(summary.subtotal)}`,
    `送料：${money(summary.shipping)}`,
    `お支払い合計：${money(summary.total)}（税込）`,
    "",
    "お届け先：",
    `${customer.name || "氏名未取得"} 様`,
    customer.address || "住所未取得（Stripeで要確認）",
    `電話番号：${customer.phone || "未取得"}`,
  ];
  if (role === "admin") {
    return [
      "VULKIT VB108 の支払済み注文を受け付けました。",
      "発送前に、下記のカラー・数量とStripe上の配送先をご確認ください。",
      "", ...common, `購入者メール：${customer.email || "未取得"}`, "", `Stripe Session：${sessionId}`,
    ].join("\n");
  }
  return [
    `${customer.name || "お客様"} 様`, "",
    "この度はVULKIT VB108をご購入いただき、ありがとうございます。",
    "決済が完了し、ご注文を受け付けました。", "", ...common, "",
    "お問い合わせの際は、このメールに返信し、ご注文番号をお知らせください。",
    "KAMACRAFY", replyTo,
  ].join("\n");
}

function notificationHtml(text) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#fff;color:#333;font-family:Arial,'Hiragino Kaku Gothic ProN',Meiryo,sans-serif"><main style="max-width:640px;margin:auto;padding:32px 24px;font-size:15px;line-height:1.9">${escapeHtml(text).replace(/\n/g, "<br>")}</main></body></html>`;
}

function emailConfiguration(env) {
  const configuredFrom = clean(env.VB108_PURCHASE_EMAIL_FROM || env.PURCHASE_EMAIL_FROM || ADMIN_EMAIL, 254);
  const sender = configuredFrom.match(/<([^<>]+)>$/)?.[1] || configuredFrom;
  if (!validEmail(sender) || /[\r\n<>]/.test(sender)) throw failure("invalid_sender_configuration");
  const replyTo = clean(env.VB108_PURCHASE_EMAIL_REPLY_TO || env.PURCHASE_EMAIL_REPLY_TO || ADMIN_EMAIL, 254);
  if (!validEmail(replyTo)) throw failure("invalid_reply_to_configuration");
  let lineUrl = "";
  try {
    const url = new URL(env.VB108_LINE_URL || env.LINE_URL || DEFAULT_LINE_URL);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        ["lin.ee", "line.me", "www.line.me", "liff.line.me"].includes(url.hostname)) lineUrl = url.href;
  } catch { /* An optional LINE link must never introduce an unsafe URL. */ }
  return { from: `KAMACRAFY / VB108 <${sender}>`, replyTo, lineUrl };
}

function createVB108Fulfillment(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const getSession = options.getStripeSession || ((id) => require("./vb108-commerce").getStripeSession(id));
  const validateSession = options.verifySession || ((session) => require("./vb108-commerce").verifySession(session));
  const buildOrderEmail = options.buildOrderEmail || ((data) => require("./vb108-order-email").buildOrderEmail(data));

  function storageEndpoint() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw failure("order_storage_not_configured");
    const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/lp_events`);
    if (url.protocol !== "https:") throw failure("invalid_order_storage_configuration");
    return url;
  }

  async function storageRequest(url, init = {}) {
    let result;
    try {
      result = await fetchImpl(url, {
        ...init,
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw failure("order_storage_unavailable");
    }
    return result;
  }

  const markerId = (kind, sessionId) => `vb108_${kind}_${sha(sessionId).slice(0, 40)}`;

  async function readMarker(kind, sessionId) {
    const url = storageEndpoint();
    const id = markerId(kind, sessionId);
    url.searchParams.set("select", "event_id,event_name,occurred_at,result_target,utm_content");
    url.searchParams.set("event_id", `eq.${id}`);
    url.searchParams.set("limit", "2");
    const result = await storageRequest(url);
    if (!result.ok) throw failure("order_storage_read_failed");
    const records = await result.json();
    if (!Array.isArray(records) || records.length > 1) throw failure("order_storage_integrity_error");
    const marker = records[0];
    if (marker && (marker.event_id !== id || marker.event_name !== `vb108_${kind}` || marker.result_target !== sessionId)) {
      throw failure("order_storage_integrity_error");
    }
    return marker || null;
  }

  async function writeMarker(kind, sessionId, content, quantity = 1) {
    const marker = {
      event_id: markerId(kind, sessionId),
      event_name: `vb108_${kind}`,
      occurred_at: new Date(now()).toISOString(),
      lp_variant: "vb108",
      cta_location: "stripe_checkout",
      page_path: "/VB108",
      result_target: sessionId,
      attempt: quantity,
      // These durable markers contain order counts/totals or recipient hashes, never address/email data.
      utm_content: JSON.stringify(content),
    };
    const result = await storageRequest(storageEndpoint(), {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(marker),
    });
    if (result.ok) return marker;
    if (result.status === 409) {
      const previous = await readMarker(kind, sessionId);
      if (previous) return previous;
    }
    throw failure("order_storage_write_failed");
  }

  function readContent(marker) {
    try {
      const content = JSON.parse(marker.utm_content);
      if (content && typeof content === "object" && !Array.isArray(content)) return content;
    } catch { /* Corrupt/ambiguous persistent state must not trigger another delivery. */ }
    throw failure("order_storage_integrity_error");
  }

  async function notify(role, session, summary, customer) {
    const recipient = role === "customer" ? customer.email : ADMIN_EMAIL;
    if (!validEmail(recipient)) throw failure(`${role}_email_unavailable`);
    const recipientHash = sha(recipient);
    const sentKind = `${role}_notified`;
    const sent = await readMarker(sentKind, session.id);
    if (sent) {
      if (readContent(sent).recipient !== recipientHash) throw failure(`${role}_recipient_changed`);
      return { sent: true, duplicate: true };
    }

    const startedKind = `${role}_notification_started`;
    let started = await readMarker(startedKind, session.id);
    if (!started) {
      const configurationHash = sha(JSON.stringify(emailConfiguration(env)));
      started = await writeMarker(startedKind, session.id, { recipient: recipientHash, version: EMAIL_VERSION, configurationHash });
    }
    const previous = readContent(started);
    const version = previous.version;
    if (previous.recipient !== recipientHash || ![LEGACY_EMAIL_VERSION, PREVIOUS_EMAIL_VERSION, PREVIOUS_V3_EMAIL_VERSION, PREVIOUS_V4_EMAIL_VERSION, EMAIL_VERSION].includes(version)) throw failure(`${role}_delivery_state_changed`);
    const age = now() - Date.parse(started.occurred_at);
    if (!Number.isFinite(age) || age < -SIGNATURE_TOLERANCE_SECONDS * 1000 || age >= SAFE_DELIVERY_RETRY_MS) {
      throw failure(`${role}_delivery_requires_reconciliation`);
    }

    let payload;
    if (version === LEGACY_EMAIL_VERSION) {
      // Keep the v1 payload and provider key byte-for-byte compatible for any
      // previously started delivery. A deployment must not create a second email.
      const replyTo = clean(env.PURCHASE_EMAIL_REPLY_TO || ADMIN_EMAIL, 254);
      if (!validEmail(replyTo)) throw failure("invalid_reply_to_configuration");
      // Commerce may now expose a renamed color. Keep the original v1 body
      // independent of current display labels when retrying its existing key.
      const legacySummary = { ...summary, items: summary.items.map((item) => ({
        ...item, label: item.color === "caramel" ? "キャラメルブラウン" : item.label,
      })) };
      const text = notificationText(role, legacySummary, customer, session.id, replyTo);
      payload = {
        from: clean(env.PURCHASE_EMAIL_FROM || `VULKIT <${ADMIN_EMAIL}>`, 254),
        to: [recipient], reply_to: replyTo,
        subject: role === "customer" ? "【VULKIT VB108】ご注文ありがとうございます" : "【VULKIT VB108】受注通知",
        text, html: notificationHtml(text),
      };
    } else {
      const configuration = emailConfiguration(env);
      if (previous.configurationHash !== sha(JSON.stringify(configuration))) throw failure(`${role}_delivery_configuration_changed`);
      const rendered = await buildOrderEmail({
        role, session, summary, customer, issuedAt: started.occurred_at, templateVersion: version,
        replyTo: configuration.replyTo, lineUrl: configuration.lineUrl,
      });
      payload = {
        from: configuration.from, to: [recipient], reply_to: configuration.replyTo,
        subject: rendered.subject, text: rendered.text, html: rendered.html,
        ...(role === "customer" ? { attachments: rendered.attachments } : {}),
      };
      if (!payload.subject?.includes("VULKIT VB108") || !payload.text || !payload.html ||
          (role === "customer" && (!Array.isArray(payload.attachments) || payload.attachments.length !== 1 ||
            !/^vb108-receipt-VB108-[A-F0-9]{12}\.pdf$/.test(payload.attachments[0]?.filename || "") ||
            typeof payload.attachments[0]?.content !== "string" || !payload.attachments[0].content.startsWith("JVBER")))) {
        throw failure(`${role}_invalid_email_content`);
      }
    }
    let delivery;
    try {
      delivery = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${version}:${sha(`${session.id}:${role}:${recipient}`)}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw failure(`${role}_delivery_uncertain`);
    }
    if (!delivery.ok) throw failure(`${role}_delivery_failed`);
    const result = await delivery.json();
    if (!result || typeof result.id !== "string" || !result.id) throw failure(`${role}_delivery_uncertain`);
    const marker = await writeMarker(sentKind, session.id, {
      recipient: recipientHash, version, messageId: clean(result.id, 180),
    });
    if (readContent(marker).recipient !== recipientHash) throw failure(`${role}_recipient_changed`);
    return { sent: true, duplicate: false };
  }

  return async function handle({ rawBody, signatureHeader, event }) {
    if (!env.STRIPE_WEBHOOK_SECRET) return response(503, { ok: false, error: "VB108 webhook is not configured" });
    if (!verifyVB108Signature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET, now())) {
      return response(400, { ok: false, error: "Invalid Stripe signature" });
    }
    let verifiedEvent;
    try {
      // Authenticate the body actually received, not a separately supplied event object.
      verifiedEvent = JSON.parse(rawBody.toString("utf8"));
      if (!verifiedEvent || typeof verifiedEvent !== "object" || Array.isArray(verifiedEvent)) throw new Error();
    } catch {
      return response(400, { ok: false, error: "Invalid Stripe event" });
    }
    event = verifiedEvent;
    const incoming = event.data?.object;
    if (!SUPPORTED_EVENTS.has(event.type) || incoming?.metadata?.product !== PRODUCT) {
      return response(200, { ok: true, ignored: true });
    }
    if (incoming.object !== "checkout.session" || typeof incoming.id !== "string" ||
      !/^cs_(?:live|test)_[A-Za-z0-9]+$/.test(incoming.id) || incoming.id.length > 255) {
      return response(400, { ok: false, error: "Invalid VB108 checkout session" });
    }

    try {
      const session = await getSession(incoming.id);
      if (!session || session.id !== incoming.id || session.metadata?.product !== PRODUCT) {
        throw failure("checkout_identity_mismatch");
      }
      const summary = await validateSession(session);
      if (session.status !== "complete" || session.payment_status !== "paid" || summary.status !== "paid") {
        return response(200, { ok: true, ignored: true, reason: "awaiting_payment" });
      }
      if (!env.RESEND_API_KEY) throw failure("notification_delivery_not_configured");
      storageEndpoint();

      const purchase = {
        version: "vb108-v1",
        cart: summary.items.map(({ color, quantity }) => ({ color, quantity })),
        subtotal: summary.subtotal, shipping: summary.shipping, total: summary.total, currency: summary.currency,
      };
      const record = await writeMarker("purchase", session.id, purchase,
        summary.items.reduce((sum, item) => sum + item.quantity, 0));
      if (record.utm_content !== JSON.stringify(purchase)) throw failure("recorded_order_changed");
      const customer = customerDetails(session);
      // Independent notification states allow retries to recover a partial failure.
      const results = await Promise.allSettled([
        notify("customer", session, summary, customer),
        notify("admin", session, summary, customer),
      ]);
      const errors = results.filter((item) => item.status === "rejected");
      if (errors.length) {
        return response(500, {
          ok: false, error: "VB108 notifications incomplete",
          customer_notified: results[0].status === "fulfilled",
          admin_notified: results[1].status === "fulfilled",
          reasons: errors.map((item) => item.reason?.code || "notification_delivery_failed"),
        });
      }
      return response(200, { ok: true, order_recorded: true, customer_notified: true, admin_notified: true });
    } catch (error) {
      return response(500, { ok: false, error: "VB108 fulfillment incomplete", reason: error.code || "checkout_verification_failed" });
    }
  };
}

async function handleVB108Webhook(args) {
  return createVB108Fulfillment()(args);
}

module.exports = { createVB108Fulfillment, handleVB108Webhook, verifyVB108Signature };
