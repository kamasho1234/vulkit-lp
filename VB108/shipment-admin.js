"use strict";

(() => {
  const API = "/api/vb108-shipment-admin";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) : "—";
  const ERRORS = {
    unauthorized: "管理キーを確認してください。", admin_not_configured: "発送管理キーが設定されていません。",
    origin_not_allowed: "公開サイトの発送管理画面から操作してください。", invalid_template: "件名・本文の文字数と「VB108」の記載を確認してください。VBP101の文面は保存できません。",
    unknown_variable: "文面の差し込み項目を確認してください。", not_paid_vb108_order: "決済済みのVB108注文ではありません。",
    wrong_payment_mode: "決済環境が一致しません。", order_verification_failed: "商品の明細・数量・金額を確認できません。",
    payment_requires_review: "返金・決済状況をStripeで確認してください。送信していません。", customer_details_missing: "宛先・お届け先が不足しています。Stripeの注文情報を確認してください。",
    delivery_requires_review: "前回の送信結果をResend・Stripeで確認してください。二重送信を防ぐため自動再送を停止しています。",
    delivery_state_changed: "前回の送信操作後に注文情報が変わっています。送信結果と注文内容を確認してください。",
    order_hidden: "この注文は非表示になっているため送信できません。", mail_not_configured: "メール送信サービスが設定されていません。",
    invalid_email_configuration: "送信元メールアドレスの設定を確認してください。", storage_integrity_error: "発送管理データの確認が必要です。操作を停止しました。",
    mail_delivery_failed: "メールサービスで送信を完了できませんでした。時間をおいて再確認してください。",
    mail_delivery_uncertain: "送信結果を確定できませんでした。同じ注文の再操作では重複送信を防止します。",
    storage_failed: "履歴の読み込み・保存に失敗しました。送信操作の場合は再読み込みして状況を確認してください。",
    network_error: "通信が完了しませんでした。送信操作中の場合は再読み込みして状況を確認してください。",
  };
  const errorText = (code) => ERRORS[code] || "処理を完了できませんでした。時間をおいて再読み込みしてください。";
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function csvFor(orders) {
    const rows = [["SKU", "数量", "toB出荷", "郵便番号", "住所", "宛名", "電話番号", "配送日", "配送時間", "オプション", "注文番号", "配送元", "メモ"]];
    for (const order of orders) for (const item of order.items) rows.push([
      item.sku, item.quantity, "はい", order.postal_code,
      [order.address_state, order.address_city, order.address_line1, order.address_line2].filter(Boolean).join(" "),
      order.name, order.phone, order.delivery_date || "", order.delivery_time || "", order.shipping_options || "",
      order.order_number, order.ship_from || "KAMACRAFY", `VULKIT VB108 / ${item.label} / 注文合計 ${order.amount_label}`,
    ]);
    return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const scoped = (orders, scope, selected) => orders.filter((row) => scope === "all" || (scope === "selected" ? selected.has(row.session_id) : row.status === scope));
  const helpers = { escapeHtml, date, errorText, csvCell, csvFor, scoped };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  if (typeof document === "undefined") return;

  const $ = (id) => document.getElementById(id);
  let orders = [], logs = [], nextCursor = "", savedTemplate = null, busy = false, authenticated = false;
  const selected = new Set();
  const dirty = () => Boolean(savedTemplate && ($("template-subject").value !== savedTemplate.subject || $("template-body").value !== savedTemplate.body));
  const message = (id, text, kind = "") => { $(id).textContent = text; $(id).classList.remove("error", "success"); if (kind) $(id).classList.add(kind); };
  function lock(value) {
    busy = value;
    document.querySelectorAll("main button, main input, main select, main textarea").forEach((node) => { node.disabled = value; });
    $("admin-content").setAttribute("aria-busy", String(value));
    if (!value) actionState();
  }
  function actionState() {
    if (busy) return;
    const chosen = orders.filter((row) => selected.has(row.session_id));
    $("send-selected").disabled = !chosen.some((row) => row.status === "pending");
    $("hide-selected").disabled = !chosen.length;
    $("clear-selection").disabled = !chosen.length;
    $("export-csv").disabled = !orders.length;
    $("send-selected").textContent = `選択した注文に送信${chosen.length ? `（${chosen.filter((r) => r.status === "pending").length}件）` : ""}`;
  }
  function clearPrivate() {
    orders = []; logs = []; selected.clear(); savedTemplate = null; nextCursor = ""; authenticated = false;
    $("admin-content").hidden = true; $("orders-body").replaceChildren(); $("history-body").replaceChildren();
    $("template-subject").value = ""; $("template-body").value = "";
    $("email-meta").replaceChildren(); $("email-body").textContent = ""; $("email-dialog").close();
    message("operation-results", ""); message("template-status", "");
  }
  async function api(body, cursor = "") {
    let response;
    try {
      response = await fetch(API + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), {
        method: body ? "POST" : "GET", headers: { "x-admin-key": $("admin-key").value, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(90000),
      });
    } catch { throw Object.assign(new Error(errorText("network_error")), { code: "network_error" }); }
    if (response.status === 401 || response.status === 403) {
      clearPrivate();
      const code = response.status === 401 ? "unauthorized" : "origin_not_allowed";
      throw Object.assign(new Error(errorText(code)), { code });
    }
    let data; try { data = await response.json(); } catch { throw new Error(errorText("network_error")); }
    if (!data || typeof data !== "object") throw new Error(errorText("network_error"));
    if (!response.ok || !data.ok) {
      throw Object.assign(new Error(errorText(data.error)), { code: data.error });
    }
    return data;
  }
  function renderOrders() {
    const rows = scoped(orders, $("status-filter").value, selected);
    $("orders-body").innerHTML = rows.length ? rows.map((row) => {
      const state = ["pending", "sent", "review"].includes(row.status) ? row.status : "review";
      return `<tr><td><input class="check" type="checkbox" data-session-id="${escapeHtml(row.session_id)}" aria-label="${escapeHtml(row.order_number)}を選択" ${selected.has(row.session_id) ? "checked" : ""}></td><td><span class="badge ${state}">${({ pending: "未送信", sent: "送信済み", review: "要確認" })[state]}</span>${row.delivery_note ? `<div class="row-note">${escapeHtml(row.delivery_note)}</div>` : ""}</td><td><span class="order-number">${escapeHtml(row.order_number)}</span><span class="sub">${escapeHtml(date(row.purchased_at))}</span></td><td class="customer">${escapeHtml(row.name)}<span class="sub">${escapeHtml(row.email)}</span><span class="sub">${escapeHtml(row.phone)}</span></td><td class="items">${row.items.map((item) => `${escapeHtml(item.label)} × ${escapeHtml(item.quantity)}点<span class="sub">${escapeHtml(item.sku)}</span>`).join("<br>")}</td><td>${escapeHtml(row.quantity)}点<span class="sub">${escapeHtml(row.amount_label)}</span></td><td class="address">${escapeHtml(row.address)}</td><td>${escapeHtml(date(row.sent_at))}</td></tr>`;
    }).join("") : '<tr><td colspan="8">該当する注文はありません。</td></tr>';
    $("order-count").textContent = `読み込み済み ${orders.length}件 ／ 表示 ${rows.length}件 ／ 選択 ${selected.size}件`;
    $("load-more").hidden = !nextCursor;
    $("paging-note").textContent = nextCursor ? "さらに古い注文があります。CSVに含めたい注文を追加で読み込んでください。" : "取得できる注文はすべて読み込みました。";
    actionState();
  }
  function renderHistory() {
    $("history-body").innerHTML = logs.length ? logs.map((row, index) => `<tr><td>${escapeHtml(date(row.sent_at))}</td><td>${escapeHtml(row.order_number)}<span class="sub">${escapeHtml(row.to)}</span></td><td>${escapeHtml(row.subject)}</td><td class="preview">${escapeHtml(row.preview)}</td><td><button class="tiny" type="button" data-log-index="${index}">詳細を見る</button></td></tr>`).join("") : '<tr><td colspan="5">送信履歴はまだありません。</td></tr>';
  }
  async function load({ more = false, merge = false } = {}) {
    const data = await api(null, more ? nextCursor : "");
    if (more || merge) {
      const byId = new Map(orders.map((row) => [row.session_id, row]));
      data.purchases.forEach((row) => byId.set(row.session_id, row));
      orders = [...byId.values()].sort((a, b) => Date.parse(b.purchased_at) - Date.parse(a.purchased_at));
    } else { orders = data.purchases; selected.clear(); }
    if (!merge) nextCursor = data.next_cursor;
    if (data.template && !dirty()) {
      savedTemplate = data.template; $("template-subject").value = data.template.subject; $("template-body").value = data.template.body;
      message("template-status", data.template.updated_at ? `保存日時：${date(data.template.updated_at)}` : "初期文面です。必要に応じて編集・保存してください。");
    }
    if (data.email_logs) { logs = data.email_logs; renderHistory(); }
    authenticated = true; $("admin-content").hidden = false; renderOrders();
    message("load-status", `${orders.length}件を読み込みました。${data.warnings.length ? `\n${data.warnings.length}件は注文情報を確認できなかったため表示していません。再読み込みしてご確認ください。` : ""}`, data.warnings.length ? "error" : "success");
  }
  $("load-button").addEventListener("click", async () => {
    if (busy) return;
    if (!$("admin-key").value) return message("load-status", "管理キーを入力してください。", "error");
    if (dirty() && !confirm("保存していない文面を破棄して再読み込みしますか？")) return;
    clearPrivate(); lock(true); message("load-status", "VB108の注文を読み込んでいます…");
    try { await load(); } catch (error) { message("load-status", error.message, "error"); } finally { lock(false); }
  });
  $("load-more").addEventListener("click", async () => {
    if (busy || !nextCursor) return; lock(true);
    try { await load({ more: true }); } catch (error) { message("load-status", error.message, "error"); } finally { lock(false); }
  });
  $("admin-key").addEventListener("input", () => { if (authenticated) clearPrivate(); message("load-status", "管理キーを入力して「読み込む」を押してください。"); });
  $("admin-key").addEventListener("keydown", (event) => { if (event.key === "Enter") $("load-button").click(); });
  $("logout-button").addEventListener("click", () => {
    if (busy || (dirty() && !confirm("保存していない文面を破棄して画面をクリアしますか？"))) return;
    clearPrivate(); $("admin-key").value = ""; message("load-status", "管理情報をクリアしました。"); $("admin-key").focus();
  });
  for (const id of ["template-subject", "template-body"]) $(id).addEventListener("input", () => message("template-status", dirty() ? "未保存の変更があります。送信前に保存してください。" : "保存済みの文面です。"));
  $("save-template").addEventListener("click", async () => {
    if (busy || !authenticated) return; lock(true);
    try {
      const data = await api({ action: "template", subject: $("template-subject").value, body: $("template-body").value });
      savedTemplate = data.template; $("template-subject").value = savedTemplate.subject; $("template-body").value = savedTemplate.body;
      message("template-status", `文面を保存しました（${date(savedTemplate.updated_at)}）。`, "success");
    } catch (error) { message("template-status", error.message, "error"); message("load-status", error.message, "error"); } finally { lock(false); }
  });
  $("orders-body").addEventListener("change", (event) => {
    const id = event.target.dataset.sessionId; if (!id || busy) return;
    event.target.checked ? selected.add(id) : selected.delete(id); renderOrders();
  });
  $("status-filter").addEventListener("change", renderOrders);
  $("select-pending").addEventListener("click", () => { if (busy) return; selected.clear(); scoped(orders, $("status-filter").value, selected).filter((row) => row.status === "pending").forEach((row) => selected.add(row.session_id)); renderOrders(); });
  $("clear-selection").addEventListener("click", () => { if (!busy) { selected.clear(); renderOrders(); } });
  async function operate(action) {
    if (busy || !authenticated) return;
    if (action === "send" && dirty()) return message("operation-results", "編集した文面を保存してから送信してください。", "error");
    const chosen = orders.filter((row) => selected.has(row.session_id) && (action !== "send" || row.status === "pending"));
    if (!chosen.length) return;
    const question = action === "send" ? `VB108の${chosen.length}件に発送完了メールを送信します。実際の発送が完了していることを確認しましたか？\n送信済み・要確認の注文には送信しません。` : `${chosen.length}件をこの一覧から非表示にします。\nStripeの注文や決済、送信履歴は削除されません。この画面では元に戻せません。`;
    if (!confirm(question)) return;
    lock(true); const lines = []; let count = 0, failed = 0;
    try {
      // One order per request: no server-side truncation and clear partial progress.
      for (const order of chosen) {
        message("operation-results", `${action === "send" ? "送信" : "非表示"}処理中… ${count}/${chosen.length}件\n${lines.join("\n")}`);
        const data = await api({ action, session_ids: [order.session_id] });
        const result = data.results.find((item) => item.session_id === order.session_id);
        if (!result) throw new Error(errorText("network_error"));
        count++;
        if (result.ok) {
          selected.delete(order.session_id);
          if (action === "send") { order.status = "sent"; order.sent_at = result.sent_at || order.sent_at || new Date().toISOString(); order.delivery_note = ""; }
          else orders = orders.filter((item) => item.session_id !== order.session_id);
          lines.push(`${order.order_number}：${action === "delete" ? "非表示にしました" : result.skipped ? "送信済み（再送していません）" : "送信しました"}`);
        } else {
          failed++; lines.push(`${order.order_number}：${errorText(result.error)}`);
          if (["delivery_requires_review", "delivery_state_changed", "payment_requires_review"].includes(result.error)) { order.status = "review"; order.delivery_note = errorText(result.error); }
        }
        renderOrders(); lock(true);
      }
      message("operation-results", `${count}件の処理が完了しました${failed ? `（${failed}件は要確認）` : ""}。\n${lines.join("\n")}`, failed ? "error" : "success");
      try { await load({ merge: true }); } catch (error) { message("load-status", `処理結果は上記をご確認ください。${error.message}`, "error"); }
    } catch (error) {
      if (authenticated) message("operation-results", `${count}/${chosen.length}件まで処理しました。後続の処理は停止しました。\n${lines.join("\n")}\n${error.message}`, "error");
      message("load-status", error.message, "error");
    } finally { lock(false); }
  }
  $("send-selected").addEventListener("click", () => operate("send"));
  $("hide-selected").addEventListener("click", () => operate("delete"));
  $("export-csv").addEventListener("click", () => {
    if (busy || !authenticated) return;
    const rows = scoped(orders, $("csv-scope").value, selected);
    if (!rows.length) return message("operation-results", "CSV出力の対象となる注文がありません。", "error");
    const url = URL.createObjectURL(new Blob([csvFor(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `VB108-shipment-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("operation-results", `${rows.length}件の注文をCSVに出力しました。複数カラーの注文は、カラーごとに1行になります。`, "success");
  });
  $("history-body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-log-index]"); if (!button || busy) return;
    const row = logs[Number(button.dataset.logIndex)]; if (!row) return;
    const fields = [["送信日時", date(row.sent_at)], ["注文番号", row.order_number], ["宛先", row.to], ["件名", row.subject], ["メールID", row.message_id]];
    $("email-meta").innerHTML = fields.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
    $("email-body").textContent = row.text; $("email-dialog").showModal();
  });
  $("close-dialog").addEventListener("click", () => $("email-dialog").close());
  window.addEventListener("beforeunload", (event) => { if (busy || dirty()) { event.preventDefault(); event.returnValue = ""; } });
})();
