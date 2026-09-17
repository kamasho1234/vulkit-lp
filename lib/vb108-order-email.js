"use strict";

const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const PRODUCT_NAME = "VULKIT VB108 RFIDブロック機能付き 軽量セキュリティポーチ";
const FONT_PATH = path.join(__dirname, "../api/lib/fonts/NotoSansJP.ttf");
const ISSUER = Object.freeze({name: "KamaCrafy", manager: "鎌倉 匠吾", address: "埼玉県新座市菅沢1-3-36", email: "ikemen@kamacrafy.com"});
const COLORS = Object.freeze({greige: "グレージュ", caramel: "キャラメルブラウン", black: "黒"});
const clean = (value, max = 500) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[char]);
const money = (value) => `${value.toLocaleString("ja-JP")}円`;
const emailIsValid = (value) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(value);

function safeLineUrl(value) {
  if (typeof value !== "string" || value.length > 600) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    if (url.hostname !== "lin.ee" && url.hostname !== "line.me" && !url.hostname.endsWith(".line.me")) return "";
    return url.href;
  } catch {return "";}
}

function formatDate(value, includeTime = false) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("ja-JP", {timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", ...(includeTime ? {hour: "2-digit", minute: "2-digit", hourCycle: "h23"} : {})}).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}年${Number(values.month)}月${Number(values.day)}日${includeTime ? ` ${values.hour}:${values.minute}` : ""}`;
}

function normalizeInput({role, session = {}, summary, customer = {}, issuedAt, replyTo, lineUrl, templateVersion = "vb108-confirmation-v4"} = {}) {
  if (role !== "customer" && role !== "admin") throw new TypeError("Invalid VB108 email role");
  if (!["vb108-confirmation-v2", "vb108-confirmation-v3", "vb108-confirmation-v4"].includes(templateVersion)) throw new TypeError("Invalid VB108 email template version");
  if (!summary || summary.status !== "paid" || summary.currency !== "JPY") throw new TypeError("Only verified paid VB108 orders can generate mail");
  if (!Array.isArray(summary.items) || summary.items.length < 1 || summary.items.length > Object.keys(COLORS).length) throw new TypeError("Invalid VB108 order items");
  const seen = new Set();
  const items = summary.items.map((item) => {
    if (!item || !Object.hasOwn(COLORS, item.color) || seen.has(item.color) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 5 || !Number.isSafeInteger(item.subtotal) || item.subtotal <= 0) throw new TypeError("Invalid VB108 order item");
    seen.add(item.color);
    return {color: item.color, label: item.color === "caramel" && templateVersion === "vb108-confirmation-v4" ? "モカブラウン" : COLORS[item.color], quantity: item.quantity, subtotal: item.subtotal};
  }).sort((left, right) => Object.keys(COLORS).indexOf(left.color) - Object.keys(COLORS).indexOf(right.color));
  const {subtotal, shipping, total} = summary;
  if (![subtotal, shipping, total].every((value) => Number.isSafeInteger(value) && value >= 0) || subtotal <= 0 || total !== subtotal + shipping || subtotal !== items.reduce((sum, item) => sum + item.subtotal, 0)) throw new TypeError("Invalid VB108 order totals");
  const orderReference = clean(summary.orderReference, 80);
  if (orderReference !== summary.orderReference || !/^VB108-[A-Za-z0-9_-]{1,64}$/.test(orderReference)) throw new TypeError("Invalid VB108 order reference");
  if (typeof issuedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(issuedAt) || !Number.isFinite(new Date(issuedAt).getTime())) throw new TypeError("A fixed VB108 issue timestamp is required");
  const issueDate = new Date(issuedAt);
  const created = Number(session.created);
  const orderDate = Number.isFinite(created) && created > 0 && Number.isFinite(new Date(created * 1000).getTime()) ? new Date(created * 1000) : issueDate;
  const contact = clean(replyTo || ISSUER.email, 254);
  if (!emailIsValid(contact)) throw new TypeError("Invalid VB108 reply address");
  return {
    role, items, subtotal, shipping, total, orderReference, issueDate, orderDate,
    lineLabel: templateVersion === "vb108-confirmation-v2" ? "販売店LINE" : "VULKITのLINE",
    sessionId: clean(session.id, 255), replyTo: contact, lineUrl: safeLineUrl(lineUrl),
    customer: {name: clean(customer.name, 120), email: clean(customer.email, 254), phone: clean(customer.phone, 80), address: clean(customer.address, 700)},
  };
}

function orderText(order) {
  return [
    PRODUCT_NAME,
    `ご注文番号：${order.orderReference}`,
    `ご注文日時：${formatDate(order.orderDate, true)}（日本時間）`,
    "",
    ...order.items.map((item) => `${item.label} × ${item.quantity}点　${money(item.subtotal)}（税込）`),
    `商品小計：${money(order.subtotal)}（税込）`,
    `送料：${order.shipping === 0 ? "無料（0円）" : money(order.shipping)}`,
    `お支払い合計：${money(order.total)}（税込）`,
  ];
}

function shippingText(order) {
  return ["お届け先：", order.customer.name ? `${order.customer.name} 様` : "氏名未取得（Stripeで要確認）", order.customer.address || "住所未取得（Stripeで要確認）", `電話番号：${order.customer.phone || "未取得"}`];
}

function buildText(order) {
  const common = orderText(order);
  if (order.role === "admin") return [
    "VULKIT VB108 購入通知（住所配送）", "",
    "住所配送の支払済み注文を受け付けました。発送前に、カラー・数量とStripe上の配送先をご確認ください。", "",
    ...common, "", ...shippingText(order), `購入者メール：${order.customer.email || "未取得"}`, "",
    `Stripe Session：${order.sessionId || "未取得"}`, "", "KamaCrafy / VULKIT VB108",
  ].join("\n");
  return [
    order.customer.name ? `${order.customer.name} 様` : "お客様", "",
    "ご購入ありがとうございます。", "この度はVULKIT VB108をご購入いただき、誠にありがとうございます。",
    "決済が完了し、ご注文を受け付けました。",
    "商品は即日発送でお届けします。土日祝のご注文は翌営業日発送となります。", "",
    ...common, "", ...shippingText(order), "",
    "領収書PDFを本メールに添付しています。", "",
    "お問い合わせの際は、このメールに返信し、ご注文番号をお知らせください。", `連絡先：${order.replyTo}`,
    ...(order.lineUrl ? ["", `VULKIT VB108の最新情報は${order.lineLabel}でもご案内しています。`, `ご希望の方は、${order.lineLabel}をご確認ください。`, order.lineUrl] : []),
    "", "引き続きVULKITをよろしくお願いいたします。", "KamaCrafy / VULKIT VB108",
  ].join("\n");
}

function htmlRows(rows) {
  return rows.map(([label, value]) => `<tr><th scope="row" style="width:116px;padding:11px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e4e7ec;background:#f8fafc;font-size:13px;font-weight:600;">${escapeHtml(label)}</th><td style="padding:11px 12px;border-bottom:1px solid #e4e7ec;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(value)}</td></tr>`).join("");
}

function buildHtml(order, subject) {
  const admin = order.role === "admin";
  const greeting = order.customer.name ? `${order.customer.name} 様` : "お客様";
  const itemRows = order.items.map((item) => [item.label, `${item.quantity}点 / ${money(item.subtotal)}（税込）`]);
  const summaryTable = `<table aria-label="ご注文内容" style="width:100%;border-collapse:collapse;margin:18px 0 26px;font-size:14px;">${htmlRows([
    ["ご注文番号", order.orderReference], ["ご注文日時", `${formatDate(order.orderDate, true)}（日本時間）`],
    ...itemRows, ["商品小計", `${money(order.subtotal)}（税込）`], ["送料", order.shipping === 0 ? "無料（0円）" : money(order.shipping)], ["お支払い合計", `${money(order.total)}（税込）`],
  ])}</table>`;
  const shippingTable = `<table aria-label="お届け先" style="width:100%;border-collapse:collapse;margin:14px 0 26px;font-size:14px;">${htmlRows([
    ["配送先氏名", order.customer.name || "未取得"], ["配送先住所", order.customer.address || "未取得（Stripeで要確認）"], ["電話番号", order.customer.phone || "未取得"],
    ...(admin ? [["購入者メール", order.customer.email || "未取得"], ["Stripe Session", order.sessionId || "未取得"]] : []),
  ])}</table>`;
  const line = !admin && order.lineUrl ? `<div style="margin:24px 0;padding:20px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;"><p style="margin:0 0 12px;font-weight:600;color:#1d4ed8;">VULKIT VB108の最新情報を${escapeHtml(order.lineLabel)}で</p><p style="margin:0 0 16px;">ご希望の方は、${escapeHtml(order.lineLabel)}をご確認ください。</p><a href="${escapeHtml(order.lineUrl)}" style="display:inline-block;padding:12px 18px;border-radius:24px;background:#087b35;color:#fff;font-weight:600;text-decoration:none;">${escapeHtml(order.lineLabel)}を確認する</a></div>` : "";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f6f7f9;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;"><div style="max-width:640px;margin:0 auto;padding:28px 18px;"><div style="border:1px solid #e4e7ec;border-radius:16px;background:#fff;overflow:hidden;"><div style="padding:26px 24px;text-align:center;background:#0b1220;color:#fff;"><div style="font-size:23px;letter-spacing:.14em;font-weight:800;">VULKIT</div><div style="margin-top:10px;color:#dbeafe;font-size:15px;">VB108 ${admin ? "購入通知（住所配送）" : "購入完了"}</div></div><div style="padding:28px 24px;line-height:1.85;overflow-wrap:anywhere;word-break:break-word;">${admin ? "" : `<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>`}<h1 style="margin:0 0 18px;font-size:23px;line-height:1.5;color:#111827;">${admin ? "支払済み注文を受け付けました。" : "ご購入ありがとうございます。"}</h1><p style="margin:0 0 16px;">${admin ? "発送前に、カラー・数量とStripe上の配送先をご確認ください。" : "この度はVULKIT VB108をご購入いただき、誠にありがとうございます。決済が完了し、ご注文を受け付けました。"}</p>${admin ? "" : '<p style="margin:0 0 22px;">商品は<strong>即日発送</strong>でお届けします。<br><span style="font-size:13px;color:#626976;">土日祝のご注文は翌営業日発送となります。</span></p>'}<h2 style="margin:24px 0 10px;font-size:18px;">ご注文内容</h2><p style="margin:0 0 12px;font-size:14px;">${escapeHtml(PRODUCT_NAME)}</p>${summaryTable}<h2 style="margin:24px 0 10px;font-size:18px;">お届け先</h2>${shippingTable}${admin ? "" : `<p style="margin:0 0 20px;">領収書PDFを本メールに添付しています。</p><p style="margin:0 0 10px;">お問い合わせの際は、このメールに返信し、ご注文番号をお知らせください。</p><p style="margin:0 0 20px;">連絡先：<a href="mailto:${escapeHtml(order.replyTo)}" style="color:#1d4ed8;">${escapeHtml(order.replyTo)}</a></p>`}${line}<p style="margin:24px 0 0;color:#626976;font-size:13px;">KamaCrafy / VULKIT VB108</p></div></div></div></body></html>`;
}

async function buildReceiptPdf(order) {
  if (!fs.existsSync(FONT_PATH)) throw new Error("VB108 receipt font is unavailable");
  const doc = new PDFDocument({size: "A4", margin: 0, compress: true, autoFirstPage: true, info: {
    Title: "VULKIT VB108 領収書", Author: ISSUER.name, Subject: order.orderReference,
    Creator: "KamaCrafy / VULKIT VB108", CreationDate: order.issueDate, ModDate: order.issueDate,
  }});
  const result = new Promise((resolve, reject) => {const chunks = []; doc.on("data", (chunk) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);});
  doc.registerFont("Japanese", FONT_PATH);
  const x = 56; const width = doc.page.width - x * 2;
  const text = (value, y, size = 10, color = "#334155", options = {}) => {doc.font("Japanese").fontSize(size).fillColor(color).text(value, x, y, {width, lineGap: 2, ...options}); return doc.y;};
  doc.save().lineWidth(1.2).strokeColor("#c69328").rect(28, 28, doc.page.width - 56, doc.page.height - 56).stroke().restore();
  doc.save().lineWidth(0.5).strokeColor("#e7c66b").rect(35, 35, doc.page.width - 70, doc.page.height - 70).stroke().restore();
  doc.save().rect(44, 44, doc.page.width - 88, 68).fill("#0b1220").restore();
  doc.font("Helvetica-Bold").fontSize(21).fillColor("#ffffff").text("VULKIT", 44, 60, {width: doc.page.width - 88, align: "center"});
  text("VB108", 88, 11, "#dbeafe", {align: "center"});
  text("領 収 書", 134, 27, "#111827", {align: "center"});
  text(`領収書番号：${order.orderReference}`, 181, 9);
  text(`発行日：${formatDate(order.issueDate)}`, 199, 9);
  const recipient = order.customer.name ? `${order.customer.name} 様` : "お客様";
  const recipientBottom = text(recipient, 226, 13, "#111827", {lineGap: 3});
  const amountTop = recipientBottom + (order.items.length > 2 ? 12 : 18);
  doc.save().rect(x, amountTop, width, 66).fill("#f8fafc").restore();
  text("領収金額（税込）", amountTop + 10, 10, "#475569", {align: "center"});
  text(money(order.total), amountTop + 28, 26, "#111827", {align: "center"});
  let y = text(`但し、${PRODUCT_NAME}代として。`, amountTop + 84, 10, "#334155") + 5;
  y = text("上記金額を正に領収いたしました。", y, 10) + 16;
  y = text("購入明細", y, 14, "#111827") + 8;
  const row = (label, value, rowY, height = 27, shade = false, size = 10) => {
    if (shade) doc.save().rect(x, rowY, width, height).fill("#f8fafc").restore();
    doc.save().strokeColor("#e1e5ea").lineWidth(0.5).moveTo(x, rowY + height).lineTo(x + width, rowY + height).stroke().restore();
    doc.font("Japanese").fontSize(size).fillColor("#334155").text(label, x + 12, rowY + 8, {width: width - 158, lineGap: 2});
    doc.font("Japanese").fontSize(size).fillColor("#111827").text(value, x + width - 134, rowY + 8, {width: 122, align: "right", lineGap: 2});
    return rowY + height;
  };
  y = row("商品・カラー / 数量", "金額（税込）", y, 29, true, 9);
  // Leave existing one/two-color receipt bytes unchanged for pending email retries.
  // Three rows use the same spacing as totals so 120-character names still fit.
  for (const item of order.items) y = row(`VB108 ${item.label} × ${item.quantity}点`, money(item.subtotal), y, order.items.length > 2 ? 27 : 33);
  y = row("商品小計（税込）", money(order.subtotal), y, 27);
  y = row("送料", order.shipping === 0 ? "無料（0円）" : money(order.shipping), y, 27);
  y = row("お支払い合計（税込）", money(order.total), y, 33, true, 11);
  text(`ご注文日時：${formatDate(order.orderDate, true)}（日本時間）`, y + 12, 9);
  if (doc.y > 721) throw new Error("VB108 receipt content exceeds its single-page layout");
  doc.save().strokeColor("#d6e0e7").lineWidth(0.7).moveTo(x, 737).lineTo(x + width, 737).stroke().restore();
  text(`販売業者：${ISSUER.name}`, 746, 11, "#111827");
  text(`運営責任者：${ISSUER.manager}`, 766, 9);
  text(`所在地：${ISSUER.address}`, 781, 9);
  text(`メール：${ISSUER.email}`, 796, 9);
  doc.end();
  return result;
}

async function buildOrderEmail(input) {
  const order = normalizeInput(input);
  const subject = order.role === "customer" ? "【VULKIT VB108】ご購入ありがとうございます" : "【VULKIT VB108】購入通知（住所配送）";
  const email = {subject, text: buildText(order), html: buildHtml(order, subject)};
  if (order.role === "customer") email.attachments = [{filename: `vb108-receipt-${order.orderReference}.pdf`, content: (await buildReceiptPdf(order)).toString("base64")}];
  return email;
}

module.exports = {buildOrderEmail};
