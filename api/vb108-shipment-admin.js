"use strict";

// VB108 only. VBP101 endpoints, templates, delivery state and logs are not shared.
const crypto = require("node:crypto");
const PRODUCT = "VULKIT VB108";
const PAGE = "/VB108/shipment-admin.html";
const ORIGIN = "https://vulkit.kamacrafy.com";
const PREFIX = "vb108_shipment_";
const VARIANT = "vb108-shipment";
const VERSION = "vb108-shipment-v1";
const RETRY_WINDOW = 23 * 60 * 60 * 1000;
const SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{16,200}$/;
const VARIABLES = new Set(["name", "email", "phone", "address", "plan", "items", "quantity", "amount", "order_number", "session_id", "shipped_at"]);
const DEFAULT_TEMPLATE = Object.freeze({
  subject: "【VULKIT VB108】発送完了のお知らせ",
  body: "{{name}} 様\n\nこの度はVULKIT VB108をご購入いただき、ありがとうございます。\n本日、商品の発送が完了しました。\n\nご注文番号：{{order_number}}\n{{items}}\n\nお届け先：\n{{address}}\n\n到着まで今しばらくお待ちください。\n\nKAMACRAFY / VULKIT VB108",
});
const clean = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = (code, status = 502) => Object.assign(new Error(code), { code, status });
const emailValid = (email) => typeof email === "string" && email.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const markerId = (kind, id) => `${PREFIX}${kind}_${hash(id).slice(0, 40)}`;
const money = (value) => `${Number(value).toLocaleString("ja-JP")}円`;

function bodyObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("invalid_request", 400);
  return body;
}
function sessionIds(body) {
  if (!Array.isArray(body.session_ids) || !body.session_ids.length || body.session_ids.length > 5 || body.session_ids.some((id) => typeof id !== "string" || !SESSION.test(id))) throw fail("invalid_session_ids", 400);
  return [...new Set(body.session_ids)];
}
function validateTemplate(value) {
  if (typeof value.subject !== "string" || typeof value.body !== "string" || value.subject.length > 160 || value.body.length > 3000) throw fail("invalid_template", 400);
  const subject = value.subject.trim(), body = value.body.trim();
  if (!subject || !body || /[\r\n\x00-\x1f]/.test(subject) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body) || !/VB108/.test(subject) || !/VB108/.test(body) || /VBP\s*101/i.test(subject + body)) throw fail("invalid_template", 400);
  for (const text of [subject, body]) {
    const withoutVariables = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => { if (!VARIABLES.has(key)) throw fail("unknown_variable", 400); return ""; });
    if (/[{}]/.test(withoutVariables)) throw fail("unknown_variable", 400);
  }
  return { subject, body };
}
function details(session) {
  const shipping = session.collected_information?.shipping_details || session.shipping_details || {};
  const customer = session.customer_details || {};
  const stripeCustomer = typeof session.customer === "object" && session.customer ? session.customer : {};
  const address = shipping.address || customer.address || stripeCustomer.shipping?.address || stripeCustomer.address || {};
  return {
    name: clean(shipping.name || customer.name || stripeCustomer.name, 120),
    email: clean(customer.email || session.customer_email || stripeCustomer.email, 254).toLowerCase(),
    phone: clean(shipping.phone || customer.phone || stripeCustomer.shipping?.phone || stripeCustomer.phone, 80),
    postal_code: clean(address.postal_code, 30), address_state: clean(address.state, 100),
    address_city: clean(address.city, 100), address_line1: clean(address.line1, 180), address_line2: clean(address.line2, 180),
    country: clean(address.country, 2),
  };
}
function normalize(session, summary, colors) {
  const customer = details(session);
  const address = [customer.postal_code ? `〒${customer.postal_code}` : "", customer.address_state, customer.address_city, customer.address_line1, customer.address_line2].filter(Boolean).join(" ");
  const items = summary.items.map((item) => {
    const color = colors[item.color];
    if (!color?.sku || !color.label) throw fail("order_verification_failed", 409);
    return { color: item.color, label: color.label, sku: color.sku, quantity: item.quantity, subtotal: item.subtotal };
  });
  return {
    ...customer, address, session_id: session.id, order_number: summary.orderReference,
    purchased_at: new Date(session.created * 1000).toISOString(),
    items, plan: items.map((item) => `${item.label} × ${item.quantity}点`).join(" / "),
    quantity: items.reduce((total, item) => total + item.quantity, 0), amount: summary.total,
    amount_label: money(summary.total), ship_from: "KAMACRAFY", delivery_date: "", delivery_time: "", shipping_options: "",
  };
}
function configuration(env) {
  const configured = clean(env.VB108_SHIPMENT_EMAIL_FROM || env.SHIPMENT_EMAIL_FROM || env.VB108_PURCHASE_EMAIL_FROM || env.PURCHASE_EMAIL_FROM || "ikemen@kamacrafy.com", 254);
  const sender = configured.match(/<([^<>]+)>$/)?.[1] || configured;
  const replyTo = clean(env.VB108_SHIPMENT_EMAIL_REPLY_TO || env.SHIPMENT_EMAIL_REPLY_TO || env.VB108_PURCHASE_EMAIL_REPLY_TO || env.PURCHASE_EMAIL_REPLY_TO || "ikemen@kamacrafy.com", 254);
  if (!emailValid(sender) || !emailValid(replyTo)) throw fail("invalid_email_configuration", 503);
  return { from: `VULKIT <${sender}>`, reply_to: replyTo };
}
function payloadFor(template, purchase, issuedAt, env) {
  const values = {
    ...purchase, items: purchase.items.map((item) => `${item.label} × ${item.quantity}点`).join("\n"),
    amount: purchase.amount_label, shipped_at: new Date(issuedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }),
  };
  const replace = (text) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => String(values[key] ?? ""));
  const subject = replace(template.subject), text = replace(template.body);
  if (/[\r\n\x00-\x1f]/.test(subject) || subject.length > 500) throw fail("invalid_email_subject", 400);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VB108 発送完了のお知らせ</title></head><body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Arial,Meiryo,sans-serif"><main style="max-width:640px;margin:auto;padding:28px 18px"><div style="background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden"><header style="background:#0b1220;color:#fff;padding:24px;text-align:center"><strong style="font-size:22px;letter-spacing:.14em">VULKIT</strong><div style="margin-top:8px;font-size:14px">VB108 発送完了のお知らせ</div></header><div style="padding:28px 24px;line-height:1.85;white-space:pre-wrap">${escapeHtml(text)}</div></div></main></body></html>`;
  return { ...configuration(env), to: [purchase.email], subject, text, html };
}

function createService(options = {}) {
  const env = options.env || process.env, fetcher = options.fetch || globalThis.fetch, now = options.now || Date.now;
  const commerce = options.commerce || require("../lib/vb108-commerce");
  const getSession = options.getStripeSession || commerce.getStripeSession;
  const verifySession = options.verifySession || commerce.verifySession;

  function storageUrl() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw fail("storage_not_configured", 503);
    const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/lp_events`);
    if (url.protocol !== "https:") throw fail("storage_not_configured", 503);
    return url;
  }
  async function request(url, init, service) {
    try { return await fetcher(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(10000) }); }
    catch { throw fail(`${service}_unavailable`); }
  }
  async function storage(query, record) {
    const url = storageUrl();
    Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const response = await request(url, {
      method: record ? "POST" : "GET", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      ...(record ? { body: JSON.stringify(record) } : {}),
    }, "storage");
    if (record && response.status === 409) return { conflict: true };
    if (!response.ok) throw fail("storage_failed");
    if (record) return { conflict: false };
    let rows; try { rows = await response.json(); } catch { throw fail("storage_integrity_error"); }
    if (!Array.isArray(rows)) throw fail("storage_integrity_error");
    return rows;
  }
  async function stripe(path) {
    if (!env.STRIPE_SECRET_KEY) throw fail("stripe_not_configured", 503);
    const response = await request(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }, "stripe");
    if (!response.ok) throw fail("stripe_failed");
    try { return await response.json(); } catch { throw fail("stripe_failed"); }
  }
  function content(row) {
    try { const value = JSON.parse(row.utm_content); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* fail closed */ }
    throw fail("storage_integrity_error");
  }
  function validateMarker(row, kind, id) {
    if (row.event_id !== markerId(kind, id) || row.event_name !== PREFIX + kind || row.lp_variant !== VARIANT || row.result_target !== id) throw fail("storage_integrity_error");
    return row;
  }
  async function readMarker(kind, id) {
    const rows = await storage({ select: "event_id,event_name,lp_variant,result_target,occurred_at,utm_content", event_id: `eq.${markerId(kind, id)}`, limit: 2 });
    if (rows.length > 1) throw fail("storage_integrity_error");
    return rows[0] ? validateMarker(rows[0], kind, id) : null;
  }
  function record(kind, id, data, issuedAt) {
    return { event_id: markerId(kind, id), event_name: PREFIX + kind, occurred_at: issuedAt || new Date(now()).toISOString(), lp_variant: VARIANT, page_path: PAGE, cta_location: "vb108_shipment_admin", section_id: "vb108_shipment_admin", result_target: id, utm_content: JSON.stringify(data) };
  }
  async function writeMarker(kind, id, data, issuedAt) {
    const row = record(kind, id, data, issuedAt);
    const result = await storage({}, row);
    if (!result.conflict) return row;
    const existing = await readMarker(kind, id);
    if (!existing) throw fail("storage_integrity_error");
    return existing;
  }
  async function decide(id, mode) {
    const row = await writeMarker("decision", id, { version: VERSION, mode });
    const decision = content(row);
    if (decision.version !== VERSION || !["send", "hide"].includes(decision.mode)) throw fail("storage_integrity_error");
    return decision.mode;
  }
  async function template() {
    const rows = await storage({ select: "result_target,utm_medium,occurred_at", event_name: `eq.${PREFIX}template`, lp_variant: `eq.${VARIANT}`, order: "occurred_at.desc,event_id.desc", limit: 1 });
    return rows.length ? { ...validateTemplate({ subject: rows[0].result_target, body: rows[0].utm_medium }), updated_at: rows[0].occurred_at } : { ...DEFAULT_TEMPLATE, updated_at: "" };
  }
  async function saveTemplate(input) {
    const value = validateTemplate(input);
    const issuedAt = new Date(now()).toISOString();
    const row = { ...record("template", crypto.randomUUID(), {}, issuedAt), result_target: value.subject, utm_medium: value.body };
    const result = await storage({}, row); if (result.conflict) throw fail("storage_failed");
    return { ok: true, template: { ...value, updated_at: issuedAt } };
  }
  async function verifiedPurchase(id, checkPayment = false) {
    if (!SESSION.test(id || "")) throw fail("invalid_session", 400);
    let session;
    try { session = await getSession(id); } catch { throw fail("order_unavailable"); }
    if (session?.id !== id || session.metadata?.product !== PRODUCT || session.status !== "complete" || session.payment_status !== "paid") throw fail("not_paid_vb108_order", 409);
    if (typeof session.livemode !== "boolean" || session.livemode !== /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || "")) throw fail("wrong_payment_mode", 409);
    let summary; try { summary = await verifySession(session); } catch { throw fail("order_verification_failed", 409); }
    if (summary.status !== "paid" || !Number.isFinite(session.created)) throw fail("order_verification_failed", 409);
    if (checkPayment) {
      const id = typeof session.payment_intent === "object" ? session.payment_intent?.id : session.payment_intent;
      if (!/^pi_[A-Za-z0-9]+$/.test(id || "")) throw fail("payment_requires_review", 409);
      const payment = await stripe(`payment_intents/${id}?expand%5B%5D=latest_charge`);
      const charge = payment.latest_charge;
      if (payment.id !== id || payment.status !== "succeeded" || payment.currency !== "jpy" || payment.amount_received !== summary.total || payment.metadata?.product !== PRODUCT || !charge || typeof charge !== "object" || charge.paid !== true || charge.refunded || charge.disputed || Number(charge.amount_refunded) !== 0) throw fail("payment_requires_review", 409);
    }
    return normalize(session, summary, commerce.COLORS);
  }
  async function stateFor(ids) {
    if (!ids.length) return new Map();
    const rows = await storage({ select: "event_id,event_name,lp_variant,result_target,occurred_at,utm_content", event_name: `in.(${PREFIX}sent,${PREFIX}started,${PREFIX}deleted,${PREFIX}decision)`, lp_variant: `eq.${VARIANT}`, result_target: `in.(${ids.join(",")})`, limit: ids.length * 4 + 1 });
    const result = new Map(ids.map((id) => [id, {}]));
    for (const row of rows) {
      const kind = String(row.event_name).slice(PREFIX.length);
      if (!["sent", "started", "deleted", "decision"].includes(kind) || !result.has(row.result_target)) throw fail("storage_integrity_error");
      validateMarker(row, kind, row.result_target);
      const entry = result.get(row.result_target); if (entry[kind]) throw fail("storage_integrity_error"); entry[kind] = row;
    }
    return result;
  }
  async function history() {
    const rows = await storage({ select: "event_id,event_name,lp_variant,result_target,occurred_at,utm_content", event_name: `eq.${PREFIX}sent`, lp_variant: `eq.${VARIANT}`, order: "occurred_at.desc", limit: 500 });
    return rows.map((row) => {
      validateMarker(row, "sent", row.result_target); const saved = content(row);
      if (saved.version !== VERSION || !saved.payload || !saved.messageId) throw fail("storage_integrity_error");
      return { id: row.event_id, session_id: row.result_target, order_number: saved.orderNumber, sent_at: row.occurred_at, to: saved.payload.to[0], subject: saved.payload.subject, text: saved.payload.text, preview: saved.payload.text.slice(0, 180), message_id: saved.messageId };
    });
  }
  async function list(input = {}) {
    const cursor = input.cursor || "";
    if (cursor && !SESSION.test(cursor)) throw fail("invalid_cursor", 400);
    let after = cursor, hasMore = true, scanned = 0;
    const found = [];
    // Bounded account-wide scan. Return a continuation cursor instead of silently
    // dropping older orders or scanning an unbounded VBP101 purchase history.
    for (let page = 0; page < 5 && hasMore && found.length < 25; page++) {
      const params = new URLSearchParams({ limit: String(25 - found.length), status: "complete" });
      if (after) params.set("starting_after", after);
      const response = await stripe(`checkout/sessions?${params}`);
      if (!Array.isArray(response.data) || typeof response.has_more !== "boolean") throw fail("stripe_failed");
      const batch = response.data; scanned += batch.length;
      for (const session of batch) if (session.metadata?.product === PRODUCT && session.payment_status === "paid" && session.status === "complete" && SESSION.test(session.id)) found.push(session.id);
      hasMore = response.has_more && batch.length > 0;
      if (batch.length) { const next = batch.at(-1).id; if (!SESSION.test(next) || next === after) throw fail("stripe_failed"); after = next; }
    }
    const ids = [...new Set(found)];
    const states = await stateFor(ids);
    const purchases = [], warnings = [];
    // Small groups keep reads bounded without creating a Stripe request burst.
    for (let start = 0; start < ids.length; start += 5) {
      const page = await Promise.all(ids.slice(start, start + 5).map(async (id) => {
        const state = states.get(id); if (state.deleted || (state.decision && content(state.decision).mode === "hide")) return null;
        try {
          const purchase = await verifiedPurchase(id);
          const age = state.started ? now() - Date.parse(state.started.occurred_at) : 0;
          const review = Boolean(state.started && (!Number.isFinite(age) || age < -300000 || age >= RETRY_WINDOW));
          return { ...purchase, status: state.sent ? "sent" : review ? "review" : "pending", sent_at: state.sent?.occurred_at || "", delivery_note: !state.sent && state.started ? "前回の送信結果を確認中です。再操作は同じ内容で処理されます。" : "" };
        } catch (error) { warnings.push({ session_id: id, code: error.code || "order_unavailable" }); return null; }
      }));
      purchases.push(...page.filter(Boolean));
    }
    const [savedTemplate, logs] = cursor ? [null, null] : await Promise.all([template(), history()]);
    return { ok: true, purchases, ...(cursor ? {} : { template: savedTemplate, email_logs: logs }), next_cursor: hasMore ? after : "", has_more: hasMore, source_counts: { scanned, vb108: found.length, displayed: purchases.length }, warnings, updated_at: new Date(now()).toISOString() };
  }
  async function sendOne(id, savedTemplate) {
    const purchase = await verifiedPurchase(id, true);
    if (await readMarker("deleted", id)) throw fail("order_hidden", 409);
    const sent = await readMarker("sent", id);
    if (sent) return { session_id: id, ok: true, skipped: true, status: "already_sent", sent_at: sent.occurred_at };
    if (!emailValid(purchase.email) || !purchase.name || !purchase.postal_code || !purchase.address_line1 || purchase.country !== "JP") throw fail("customer_details_missing", 409);
    if (!env.RESEND_API_KEY) throw fail("mail_not_configured", 503);
    const fingerprint = hash(JSON.stringify({ email: purchase.email, name: purchase.name, address: purchase.address, phone: purchase.phone, items: purchase.items, amount: purchase.amount }));
    let started = await readMarker("started", id);
    const issuedAt = new Date(now()).toISOString();
    // Validate a new message before making a durable send decision. Retrying an
    // existing attempt always uses its frozen message and sender configuration.
    const prepared = started ? null : { version: VERSION, fingerprint, orderNumber: purchase.order_number, payload: payloadFor(savedTemplate, purchase, issuedAt, env) };
    // The unique event_id arbitrates send vs. hide across concurrent requests.
    if (await decide(id, "send") !== "send") throw fail("order_hidden", 409);
    if (!started) {
      started = await writeMarker("started", id, prepared, issuedAt);
    }
    const frozen = content(started), age = now() - Date.parse(started.occurred_at);
    if (frozen.version !== VERSION || frozen.fingerprint !== fingerprint || !frozen.payload || frozen.payload.to?.length !== 1 || frozen.payload.to[0] !== purchase.email || !frozen.payload.subject.includes("VB108")) throw fail("delivery_state_changed", 409);
    if (!Number.isFinite(age) || age < -300000 || age >= RETRY_WINDOW) throw fail("delivery_requires_review", 409);
    if (await readMarker("deleted", id)) throw fail("order_hidden", 409);
    const existing = await readMarker("sent", id);
    if (existing) return { session_id: id, ok: true, skipped: true, status: "already_sent", sent_at: existing.occurred_at };
    const delivery = await request("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `${VERSION}:${hash(id)}` }, body: JSON.stringify(frozen.payload) }, "mail");
    if (!delivery.ok) throw fail("mail_delivery_failed");
    let answer; try { answer = await delivery.json(); } catch { throw fail("mail_delivery_uncertain"); }
    if (!answer || typeof answer.id !== "string" || !answer.id || answer.id.length > 180) throw fail("mail_delivery_uncertain");
    // Keep the actual sent text for the authenticated history view, separate from
    // both VBP101 logs and VB108 purchase-confirmation markers.
    const delivered = await writeMarker("sent", id, { ...frozen, messageId: answer.id });
    return { session_id: id, ok: true, status: "sent", sent_at: delivered.occurred_at };
  }
  async function sendBatch(input) {
    const ids = sessionIds(input), savedTemplate = await template(), results = [];
    for (const id of ids) {
      try { results.push(await sendOne(id, savedTemplate)); }
      catch (error) { results.push({ session_id: id, ok: false, error: error.code || "send_failed" }); }
    }
    return { ok: true, sent: results.filter((r) => r.status === "sent").length, skipped: results.filter((r) => r.skipped).length, failed: results.filter((r) => !r.ok).length, results };
  }
  async function hideBatch(input) {
    const ids = sessionIds(input), results = [];
    for (const id of ids) {
      try {
        await verifiedPurchase(id);
        const decision = await decide(id, "hide");
        const [started, sent] = await Promise.all([readMarker("started", id), readMarker("sent", id)]);
        if ((decision === "send" || started) && !sent) throw fail("delivery_requires_review", 409);
        await writeMarker("deleted", id, { version: VERSION });
        results.push({ session_id: id, ok: true });
      } catch (error) { results.push({ session_id: id, ok: false, error: error.code || "delete_failed" }); }
    }
    return { ok: true, deleted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
  return { list, saveTemplate, sendBatch, hideBatch };
}

async function readBody(req) {
  if (req.body !== undefined) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
    if (Buffer.byteLength(typeof raw === "string" ? raw : JSON.stringify(raw)) > 16000) throw fail("request_too_large", 413);
    try { return bodyObject(typeof raw === "string" ? JSON.parse(raw) : raw); } catch (e) { throw fail(e.code || "invalid_request", e.status || 400); }
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 16000) throw fail("request_too_large", 413); chunks.push(Buffer.from(chunk)); }
  try { return bodyObject(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { throw fail("invalid_request", 400); }
}
function createHandler(options = {}) {
  const env = options.env || process.env;
  return async (req, res) => {
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "x-admin-key");
    if (!["GET", "POST"].includes(req.method)) { res.setHeader("Allow", "GET, POST"); return send(405, { ok: false, error: "method_not_allowed" }); }
    const expected = (env.VB108_SHIPMENT_ADMIN_KEY || env.SHIPMENT_ADMIN_KEY || "").trim();
    if (typeof expected !== "string" || !expected.trim()) return send(503, { ok: false, error: "admin_not_configured" });
    const provided = req.headers["x-admin-key"];
    if (typeof provided !== "string" || provided.length > 512 || !crypto.timingSafeEqual(Buffer.from(hash(provided.trim())), Buffer.from(hash(expected)))) return send(401, { ok: false, error: "unauthorized" });
    const origin = req.headers.origin;
    if (origin && origin !== ORIGIN) return send(403, { ok: false, error: "origin_not_allowed" });
    try {
      const service = createService(options);
      if (req.method === "GET") {
        const url = new URL(req.url, ORIGIN);
        return send(200, await service.list({ cursor: url.searchParams.get("cursor") || "" }));
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw fail("json_required", 415);
      const body = await readBody(req);
      if (body.action === "template") return send(200, await service.saveTemplate(body));
      if (body.action === "send") return send(200, await service.sendBatch(body));
      if (body.action === "delete") return send(200, await service.hideBatch(body));
      throw fail("invalid_action", 400);
    } catch (error) { return send(error.status || 502, { ok: false, error: error.code || "shipment_request_failed" }); }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.createService = createService;
module.exports.DEFAULT_TEMPLATE = DEFAULT_TEMPLATE;
module.exports.validateTemplate = validateTemplate;
module.exports.payloadFor = payloadFor;
module.exports.normalize = normalize;
