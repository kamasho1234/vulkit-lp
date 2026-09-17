(function (root) {
  "use strict";
  const CART_KEY = "vulkit.vb108.cart.v1";
  const CART_REVISION_KEY = "vulkit.vb108.cart.revision.v1";
  const CHECKOUT_CART_PREFIX = "vulkit.vb108.checkout-cart.v1.";
  const COLORS = Object.freeze({greige: {label: "グレージュ", image: "/VB108/assets/vb108-greige.jpg"}, caramel: {label: "モカブラウン", image: "/VB108/assets/vb108-caramel-brown.jpg"}, black: {label: "ブラック", image: "/VB108/assets/vb108-black-v129.jpg"}});
  const PREFECTURES = new Set("北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" "));
  const money = (value) => new Intl.NumberFormat("ja-JP", {style: "currency", currency: "JPY", maximumFractionDigits: 0}).format(value);
  const ascii = (value) => String(value || "").normalize("NFKC").trim();
  const normalizePhone = (value) => ascii(value).replace(/[\s()−ー‐-]/g, "").replace(/^\+81/, "0");

  function validateCart(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("カート情報を読み取れませんでした。");
    const cart = {};
    for (const [color, quantity] of Object.entries(value)) {
      if (!Object.hasOwn(COLORS, color) || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new TypeError("カートのカラー・数量をご確認ください。");
      cart[color] = quantity;
    }
    return cart;
  }

  function cartFromSearch(search) {
    const params = new URLSearchParams(search);
    if (!Object.keys(COLORS).some((color) => params.has(color))) return null;
    const cart = {};
    for (const color of Object.keys(COLORS)) {
      const values = params.getAll(color);
      if (!values.length) continue;
      if (values.length !== 1 || !/^[0-5]$/.test(values[0])) throw new TypeError("URLの商品数量が正しくありません。商品ページからお進みください。");
      if (Number(values[0]) > 0) cart[color] = Number(values[0]);
    }
    return validateCart(cart);
  }

  function calculateTotals(value) {
    const cart = validateCart(value);
    const items = Object.keys(COLORS).filter((color) => cart[color]).map((color) => ({color, quantity: cart[color]}));
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = quantity * 6810;
    const regularSubtotal = quantity * 8620;
    const shipping = quantity === 0 || quantity >= 2 ? 0 : 350;
    return {items, quantity, subtotal, regularSubtotal, savings: regularSubtotal - subtotal, shipping, total: subtotal + shipping, currency: "JPY"};
  }

  function adjustCartQuantity(value, color, quantity) {
    const next = validateCart(value);
    if (typeof color !== "string" || !Object.hasOwn(COLORS, color) || !Number.isInteger(quantity) || quantity < 0 || quantity > 5) throw new TypeError("数量は各カラー5点までです。");
    if (quantity === 0) delete next[color]; else next[color] = quantity;
    return next;
  }

  function splitAddress(value, hint = {}) {
    const full = String(value || "").trim();
    if (PREFECTURES.has(hint.state) && hint.city && full.startsWith(hint.state + hint.city)) return {state: hint.state, city: hint.city, line1: full.slice((hint.state + hint.city).length).trim()};
    const stateMatch = full.match(/^(北海道|東京都|大阪府|京都府|.{2,3}県)\s*(.+)$/);
    if (!stateMatch || !PREFECTURES.has(stateMatch[1])) return {state: "", city: "", line1: ""};
    const remainder = stateMatch[2];
    // 市 has priority over 町/村 inside names such as 東村山市 and 十日町市.
    // Preserve names ending in 市市 and names beginning with 市.
    const county = remainder.match(/^(.+?郡.+?[町村](?:町|村)?)\s*(.+)$/);
    const tokyoWard = stateMatch[1] === "東京都" && remainder.match(/^((?:千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川)区)\s*(.+)$/);
    const cityCandidate = remainder.match(/^((?:四日市市|廿日市市|野々市市|大和郡山市|郡山市|郡上市|市[^市郡区]+市|[^市郡区]+市))\s*(.+)$/);
    const municipality = tokyoWard || (cityCandidate && !cityCandidate[2].startsWith("郡") ? cityCandidate : county || remainder.match(/^(.+?[区町村])\s*(.+)$/));
    if (!municipality) return {state: stateMatch[1], city: "", line1: ""};
    let city = municipality[1]; let line1 = municipality[2].trim();
    const designatedCities = new Set("札幌市 仙台市 さいたま市 千葉市 横浜市 川崎市 相模原市 新潟市 静岡市 浜松市 名古屋市 京都市 大阪市 堺市 神戸市 岡山市 広島市 北九州市 福岡市 熊本市".split(" "));
    const ward = designatedCities.has(city) && line1.match(/^(.+?区)\s*(.+)$/);
    if (ward) {city += ward[1]; line1 = ward[2].trim();}
    return {state: stateMatch[1], city, line1};
  }

  function buildCustomer(fields) {
    const full = String(fields.address_full || "").trim();
    const address = splitAddress(full, {state: fields.state, city: fields.city});
    return {name: String(fields.name || "").trim(), email: ascii(fields.email).toLowerCase(), phone: normalizePhone(fields.phone), address: {country: "JP", postal_code: ascii(fields.postal_code).replace(/[-\s]/g, ""), ...address, line2: String(fields.line2 || "").trim()}, address_full: full};
  }

  function validateCustomer(customer) {
    const errors = {};
    if (!customer.name || customer.name.length > 120) errors.name = "お名前を120文字以内で入力してください。";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customer.email) || customer.email.length > 180) errors.email = "メールアドレスを正しく入力してください。";
    if (!/^0\d{9,10}$/.test(normalizePhone(customer.phone))) errors.phone = "日本国内の電話番号を10桁または11桁で入力してください。";
    if (!/^\d{7}$/.test(customer.address.postal_code)) errors.postal_code = "郵便番号を7桁で入力してください。";
    if (!customer.address_full || customer.address_full.length > 260 || !customer.address.state || !customer.address.city || customer.address.line1.length < 2 || customer.address.line1.length > 180) errors.address_full = "都道府県・市区町村・番地を入力してください。町名・番地は2〜180文字で入力してください。";
    if (customer.address.line2.length > 180) errors.line2 = "建物名・部屋番号を180文字以内で入力してください。";
    const controlChars = /[\u0000-\u001f\u007f]/;
    for (const key of ["name", "email", "phone"]) if (controlChars.test(customer[key])) errors[key] = "改行や制御文字を含めずに入力してください。";
    if ([customer.address_full, customer.address.state, customer.address.city, customer.address.line1].some((value) => controlChars.test(value))) errors.address_full = "住所は改行や制御文字を含めずに入力してください。";
    if (controlChars.test(customer.address.line2)) errors.line2 = "建物名・部屋番号は改行や制御文字を含めずに入力してください。";
    return errors;
  }

  function isStripeCheckoutUrl(value) {
    try {const url = new URL(value); return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password && !url.port;} catch {return false;}
  }

  function cartAfterPayment(current, items) {
    const cart = validateCart(current);
    const purchased = {};
    if (!Array.isArray(items) || !items.length) throw new TypeError("購入商品の情報がありません。");
    for (const item of items) {
      if (!item || !Object.hasOwn(COLORS, item.color) || Object.hasOwn(purchased, item.color)) throw new TypeError("購入商品の情報が正しくありません。");
      purchased[item.color] = item.quantity;
    }
    validateCart(purchased);
    if (Object.entries(purchased).some(([color, quantity]) => (cart[color] || 0) < quantity)) return {matches: false, cart};
    for (const [color, quantity] of Object.entries(purchased)) {cart[color] -= quantity; if (!cart[color]) delete cart[color];}
    return {matches: true, cart};
  }

  const api = {CART_KEY, CART_REVISION_KEY, CHECKOUT_CART_PREFIX, COLORS, money, normalizePhone, validateCart, cartFromSearch, calculateTotals, adjustCartQuantity, splitAddress, buildCustomer, validateCustomer, isStripeCheckoutUrl, cartAfterPayment};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.VB108Checkout = api;
  if (typeof document === "undefined" || document.body?.dataset.checkoutPage !== "shipping") return;

  const $ = (selector) => document.querySelector(selector);
  const form = $("[data-shipping-form]");
  const controls = [$("[data-checkout-submit]"), $("[data-stripe-submit]")];
  const fields = $("[data-shipping-fields]");
  const formMessage = $("[data-form-message]");
  let cart = {};
  let cartError = "";
  let usesQueryCart = false;
  let busy = false;
  let attempt = null;
  let addressRequest = null;
  let addressRevision = 0;
  let orderEditControls = [];
  let activeCheckoutRequest = null;

  function loadCart() {
    try {
      const override = cartFromSearch(root.location.search);
      usesQueryCart = override !== null;
      cart = override === null ? validateCart(JSON.parse(root.localStorage.getItem(CART_KEY) || "{}")) : override;
      cartError = calculateTotals(cart).quantity ? "" : "カラーを追加してからお進みください。";
    } catch (error) {cart = {}; cartError = error.message || "カートを確認できませんでした。商品ページからお進みください。";}
  }

  function updateOrder(color, quantity, action) {
    if (busy) return;
    let next;
    try {next = adjustCartQuantity(cart, color, quantity);} catch {return;}
    if ((cart[color] || 0) === quantity) return;
    cart = next;
    // An edit is authoritative even when persistence is unavailable. Do not
    // reload the old URL/storage cart over it at the next submit.
    usesQueryCart = true;
    const summary = calculateTotals(cart);
    cartError = summary.quantity ? "" : "カラーを追加してからお進みください。";
    try {
      const revision = root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      root.localStorage.setItem(CART_REVISION_KEY, revision);
      root.localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch { /* Edits still work in memory and are submitted directly. */ }
    try {
      const url = new URL(root.location.href);
      Object.keys(COLORS).forEach((key) => url.searchParams.set(key, String(cart[key] || 0)));
      root.history.replaceState(root.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* Navigation/storage restrictions must not undo the edit. */ }
    message("");
    renderOrder({color, action});
    $("[data-order-edit-status]").textContent = summary.quantity
      ? `ご注文は${summary.quantity}点、合計${money(summary.total)}です。${summary.shipping ? "送料350円を含みます。" : "送料無料です。"}`
      : "商品を削除しました。下からカラーを追加できます。";
  }

  function orderButton(color, action, quantity, unavailable = false) {
    const button = document.createElement("button");
    const label = COLORS[color].label;
    const labels = {increase: `${label}を1点増やす`, decrease: `${label}を1点減らす`, remove: `${label}を削除`, add: `${label}を追加`};
    button.type = "button";
    button.className = action === "add" ? "order-add-button" : action === "remove" ? "order-remove" : "order-quantity-button";
    button.textContent = action === "add" ? `＋ ${label}を追加` : action === "remove" ? "削除" : action === "increase" ? "＋" : "−";
    button.setAttribute("aria-label", labels[action]);
    button.dataset.orderEdit = "";
    button.dataset.orderAction = action;
    button.dataset.color = color;
    button.disabled = busy || unavailable;
    button.addEventListener("click", () => {if (!button.disabled) updateOrder(color, quantity, action);});
    orderEditControls.push({button, unavailable, color, action});
    return button;
  }

  function renderOrder(focus = null) {
    const summary = calculateTotals(cart);
    const container = $("[data-order-items]");
    orderEditControls = [];
    container.replaceChildren();
    if (!summary.quantity) {
      const empty = document.createElement("p"); empty.className = "order-empty"; empty.textContent = "カートは空です。下からカラーを追加してください。"; container.append(empty);
    }
    for (const item of summary.items) {
      const article = document.createElement("article"); article.className = "order-item";
      const img = document.createElement("img"); img.src = COLORS[item.color].image; img.alt = `VULKIT VB108 ${COLORS[item.color].label}`; img.width = 76; img.height = 76;
      const detail = document.createElement("div");
      const heading = document.createElement("h3"); heading.textContent = COLORS[item.color].label;
      const price = document.createElement("p"); price.textContent = `単価 ${money(6810)}（税込） × ${item.quantity}点`;
      const subtotal = document.createElement("p"); subtotal.className = "item-subtotal"; subtotal.textContent = `小計 ${money(6810 * item.quantity)}（税込）`;
      const edit = document.createElement("div"); edit.className = "order-item-controls";
      const stepper = document.createElement("div"); stepper.className = "order-quantity";
      stepper.setAttribute("role", "group"); stepper.setAttribute("aria-label", `${COLORS[item.color].label}の数量`);
      const count = document.createElement("output"); count.textContent = String(item.quantity); count.setAttribute("aria-label", `${COLORS[item.color].label}の数量`);
      stepper.append(orderButton(item.color, "decrease", item.quantity - 1, item.quantity <= 1), count, orderButton(item.color, "increase", item.quantity + 1, item.quantity >= 5));
      edit.append(stepper, orderButton(item.color, "remove", 0));
      detail.append(heading, price, edit, subtotal); article.append(img, detail); container.append(article);
    }
    const additions = $("[data-order-additions]");
    additions.replaceChildren();
    Object.keys(COLORS).filter((color) => !cart[color]).forEach((color) => additions.append(orderButton(color, "add", 1)));
    $("[data-order-subtotal]").textContent = money(summary.subtotal);
    $("[data-order-shipping]").textContent = !summary.quantity ? "—" : summary.shipping ? money(summary.shipping) : "無料";
    $("[data-order-total]").textContent = money(summary.total);
    $("[data-order-savings]").textContent = summary.quantity ? `定価より ${money(summary.savings)} お得` : "";
    $("[data-shipping-note]").textContent = summary.quantity === 1 ? "あと1点で送料無料です。" : summary.quantity >= 2 ? "2点以上のご購入で送料無料です。" : "送料350円・2点以上のご購入で送料無料";
    $("[data-shipping-note]").dataset.freeShippingReminder = String(summary.quantity === 1);
    $("[data-cart-error]").hidden = !cartError; $("[data-cart-error]").textContent = cartError;
    controls.forEach((control) => {control.disabled = busy || Boolean(cartError);});
    if (focus) {
      const available = orderEditControls.filter(({button}) => !button.disabled);
      const next = available.find((item) => item.color === focus.color && item.action === focus.action)
        || available.find((item) => item.color === focus.color && item.action === "increase")
        || available.find((item) => item.color === focus.color) || available[0];
      next?.button.focus();
    }
  }

  function message(text) {formMessage.textContent = text; formMessage.hidden = !text;}
  function setBusy(value) {busy = value; fields.disabled = value; controls.forEach((control) => {control.disabled = value || Boolean(cartError);}); orderEditControls.forEach(({button, unavailable}) => {button.disabled = value || unavailable;}); $("[data-checkout-submit]").textContent = value ? "決済画面を準備中…" : "決済に進む"; form.setAttribute("aria-busy", String(value));}
  function fieldValues() {return Object.fromEntries(new FormData(form));}
  function applyErrors(errors) {
    for (const element of form.querySelectorAll("[data-error-for]")) {const name = element.dataset.errorFor; element.textContent = errors[name] || ""; const input = form.elements.namedItem(name); if (errors[name]) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");}
    const first = Object.keys(errors)[0];
    if (first) form.elements.namedItem(first).focus();
  }

  async function lookupAddress() {
    const zip = ascii(form.elements.postal_code.value).replace(/[-\s]/g, "");
    const status = $("[data-address-status]");
    if (!/^\d{7}$/.test(zip)) {status.textContent = "郵便番号を7桁で入力してください。"; form.elements.postal_code.focus(); return;}
    addressRequest?.abort();
    const controller = new AbortController(); addressRequest = controller;
    const revision = addressRevision;
    status.textContent = "住所を検索しています…";
    const timeout = root.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${encodeURIComponent(zip)}`, {signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer"});
      if (!response.ok) throw new Error("lookup");
      const data = await response.json();
      if (addressRequest !== controller || revision !== addressRevision || busy) return;
      const result = data.results?.[0];
      if (!result || ![result.address1, result.address2, result.address3].every((part) => typeof part === "string")) {status.textContent = "住所が見つかりませんでした。手入力してください。"; return;}
      form.elements.state.value = result.address1; form.elements.city.value = result.address2;
      form.elements.address_full.value = result.address1 + result.address2 + result.address3;
      form.elements.line1.value = result.address3;
      status.textContent = "住所を自動入力しました。番地以降を入力してください。";
      form.elements.address_full.focus();
    } catch {if (addressRequest === controller && revision === addressRevision && !busy) status.textContent = "住所検索に失敗しました。住所を手入力してください。";}
    finally {root.clearTimeout(timeout); if (addressRequest === controller) addressRequest = null;}
  }

  form.addEventListener("input", (event) => {
    const input = event.target;
    input.removeAttribute("aria-invalid");
    const error = form.querySelector(`[data-error-for="${input.name}"]`); if (error) error.textContent = "";
    if (["postal_code", "address_full"].includes(input.name)) {addressRevision += 1; addressRequest?.abort(); addressRequest = null; $("[data-address-status]").textContent = "";}
    message("");
  });
  $("[data-address-autofill]").addEventListener("click", lookupAddress);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    // Re-read non-query carts before each attempt, including edits from another tab.
    if (!usesQueryCart) {loadCart(); renderOrder();}
    if (cartError) {message(cartError); formMessage.focus(); return;}
    const customer = buildCustomer(fieldValues());
    const errors = validateCustomer(customer); applyErrors(errors);
    if (Object.keys(errors).length) {message("入力内容をご確認ください。"); return;}
    const items = calculateTotals(cart).items;
    let cartSnapshot = null;
    try {
      const storedCart = validateCart(JSON.parse(root.localStorage.getItem(CART_KEY) || "{}"));
      const revision = root.localStorage.getItem(CART_REVISION_KEY);
      if (revision && JSON.stringify(calculateTotals(storedCart).items) === JSON.stringify(items)) cartSnapshot = {cart: storedCart, revision};
    } catch { /* A query-only checkout still works without cart storage. */ }
    const fingerprint = JSON.stringify({items, customer});
    if (!attempt || attempt.fingerprint !== fingerprint) {
      if (typeof root.crypto?.randomUUID !== "function") {message("安全な決済接続を準備できませんでした。最新のブラウザで開き直してください。"); return;}
      attempt = {fingerprint, id: root.crypto.randomUUID()};
    }
    message(""); setBusy(true); addressRequest?.abort();
    $("[data-submit-status]").textContent = "安全な決済画面へ接続しています。しばらくお待ちください。";
    const controller = new AbortController(); const timeout = root.setTimeout(() => controller.abort(), 25000);
    activeCheckoutRequest = controller;
    try {
      const response = await fetch("/api/vb108-checkout-session", {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", signal: controller.signal, body: JSON.stringify({items, customer, attempt_id: attempt.id, color_label_version: "vb108-color-v108"})});
      const data = await response.json();
      if (activeCheckoutRequest !== controller) return;
      if (response.status === 400) {
        setBusy(false); $("[data-submit-status]").textContent = "";
        const validationMessage = typeof data.error === "string" ? data.error.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400) : "";
        message(validationMessage || "入力内容を確認できませんでした。配送先・ご連絡先・商品数量をご確認ください。");
        formMessage.focus(); return;
      }
      if (!response.ok || data.ok !== true || !isStripeCheckoutUrl(data.url)) throw new Error("checkout");
      if (cartSnapshot && typeof data.id === "string" && /^cs_(?:test_|live_)?[A-Za-z0-9]{10,240}$/.test(data.id)) {
        try {root.localStorage.setItem(CHECKOUT_CART_PREFIX + data.id, JSON.stringify(cartSnapshot));} catch { /* Never persist personal information; cart cleanup is optional. */ }
      }
      root.location.assign(data.url);
    } catch {
      if (activeCheckoutRequest !== controller) return;
      setBusy(false); $("[data-submit-status]").textContent = "";
      message("決済画面への接続を確認できませんでした。入力内容を保持しています。時間をおいて、もう一度「決済に進む」を押してください。二重のお支払いを防ぐため、同じ内容では同じ手続きを再確認します。");
      formMessage.focus();
    } finally {root.clearTimeout(timeout); if (activeCheckoutRequest === controller) activeCheckoutRequest = null;}
  });
  root.addEventListener("storage", (event) => {if (event.key === CART_KEY && !usesQueryCart && !busy) {loadCart(); renderOrder();}});
  root.addEventListener("pagehide", () => {activeCheckoutRequest?.abort(); activeCheckoutRequest = null; addressRequest?.abort(); addressRequest = null;});
  root.addEventListener("pageshow", (event) => {if (event.persisted) {activeCheckoutRequest?.abort(); activeCheckoutRequest = null; setBusy(false); $("[data-submit-status]").textContent = ""; if (!usesQueryCart) {loadCart(); renderOrder();}}});
  $("[data-cancel-notice]").hidden = new URLSearchParams(root.location.search).get("cancelled") !== "1";
  loadCart(); renderOrder();
})(typeof window !== "undefined" ? window : globalThis);
