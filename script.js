const topVisuals = [...document.querySelectorAll(".top-visual")];
const scrollButton = document.querySelector(".scroll-button");
const floatingCoupon = document.querySelector(".mobile-floating-coupon");
const floatingCouponClose = document.querySelector(".mobile-floating-coupon__close");
const countdownBlocks = [...document.querySelectorAll("[data-countdown-target]")];
const stockAlerts = [...document.querySelectorAll("[data-benefit-stock-remaining]")];
const checkoutEntryLinks = [...document.querySelectorAll("[data-checkout-entry]")];
const checkoutButtons = [...document.querySelectorAll("[data-checkout-plan]")];
const checkoutPrefillForm = document.querySelector("[data-checkout-prefill]");
const emailSignupForms = [...document.querySelectorAll("[data-email-signup]")];
const youtubeFrames = [...document.querySelectorAll('iframe[src*="youtube.com/embed"]')];
const chatbot = document.querySelector("[data-chatbot]");
const chatbotToggle = document.querySelector("[data-chatbot-toggle]");
const chatbotClose = document.querySelector("[data-chatbot-close]");
const chatbotMessages = document.querySelector("[data-chatbot-messages]");
const chatbotForm = document.querySelector("[data-chatbot-form]");
const chatbotInput = document.querySelector("[data-chatbot-input]");
let activeTop = 0;
let floatingCouponTimer;
let floatingCouponDrag;
let floatingCouponWasDragged = false;
let chatbotDrag;
let chatbotWasDragged = false;
let sitePopupTimer;
let checkoutAddressTimer;
let lastCheckoutAddressZip = "";
let chatbotLogCounter = 0;

function forceMuteEmbeddedMedia() {
  document.querySelectorAll("video").forEach((video) => {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.setAttribute("muted", "");
  });

  youtubeFrames.forEach((frame) => {
    frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "mute", args: [] }), "https://www.youtube.com");
    frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [0] }), "https://www.youtube.com");
  });
}

function isValidEmailInput(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}

function setCheckoutFieldError(input, hasError) {
  if (!input) return;
  input.classList.toggle("is-field-error", Boolean(hasError));
  input.closest("label")?.classList.toggle("is-field-error", Boolean(hasError));
}

function clearCheckoutFieldErrors() {
  checkoutPrefillForm?.querySelectorAll(".is-field-error").forEach((item) => {
    item.classList.remove("is-field-error");
  });
}

function validateCheckoutPrefill() {
  if (!checkoutPrefillForm) return true;
  clearCheckoutFieldErrors();

  const requiredFields = [
    ["name", "お名前"],
    ["phone", "電話番号"],
    ["postal_code", "郵便番号"],
    ["state", "都道府県"],
    ["city", "市区町村"],
    ["line1", "町名・番地"],
  ];
  const missingLabels = [];
  let firstInvalidInput = null;

  requiredFields.forEach(([name, label]) => {
    const input = checkoutPrefillForm.querySelector(`[name="${name}"]`);
    const value = String(input?.value || "").trim();
    const isInvalid = !value || (name === "postal_code" && value.replace(/\D/g, "").length !== 7);
    setCheckoutFieldError(input, isInvalid);
    if (isInvalid) {
      missingLabels.push(label);
      firstInvalidInput ||= input;
    }
  });

  const emailInput = checkoutPrefillForm.querySelector('input[name="email"]');
  const email = String(emailInput?.value || "").trim();
  if (email && !isValidEmailInput(email)) {
    setCheckoutFieldError(emailInput, true);
    missingLabels.push("メールアドレスの形式");
    firstInvalidInput ||= emailInput;
  }

  if (missingLabels.length) {
    showSitePopup(
      "error",
      "お届け先情報を確認してください",
      `不足または修正が必要な項目: ${missingLabels.join("、")}`
    );
    firstInvalidInput?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => firstInvalidInput?.focus(), 320);
    return false;
  }

  return true;
}

function getCheckoutCustomerPrefill() {
  if (!checkoutPrefillForm) return null;

  if (!validateCheckoutPrefill()) return false;

  const data = new FormData(checkoutPrefillForm);
  const customer = {
    name: String(data.get("name") || "").trim(),
    phone: String(data.get("phone") || "").trim(),
    email: String(data.get("email") || "").trim(),
    address: {
      country: "JP",
      postal_code: String(data.get("postal_code") || "").trim(),
      state: String(data.get("state") || "").trim(),
      city: String(data.get("city") || "").trim(),
      line1: String(data.get("line1") || "").trim(),
      line2: String(data.get("line2") || "").trim(),
    },
  };

  if (customer.email && !isValidEmailInput(customer.email)) {
    setCheckoutFieldError(checkoutPrefillForm.querySelector('input[name="email"]'), true);
    checkoutPrefillForm.querySelector('input[name="email"]')?.focus();
    showSitePopup("error", "お届け先情報を確認してください", "メールアドレスの形式を確認してください。");
    return false;
  }

  return customer;
}

function setCheckoutAddressStatus(text, isError = false) {
  const status = checkoutPrefillForm?.querySelector("[data-address-status]");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("is-error", Boolean(isError));
}

async function autofillCheckoutAddress() {
  if (!checkoutPrefillForm) return;
  const zipInput = checkoutPrefillForm.querySelector('input[name="postal_code"]');
  const stateInput = checkoutPrefillForm.querySelector('input[name="state"]');
  const cityInput = checkoutPrefillForm.querySelector('input[name="city"]');
  const line1Input = checkoutPrefillForm.querySelector('input[name="line1"]');
  const zip = String(zipInput?.value || "").replace(/\D/g, "");

  if (zipInput && zipInput.value !== zip) {
    zipInput.value = zip;
  }

  if (zip.length < 7) {
    setCheckoutAddressStatus("");
    return;
  }

  if (zip === lastCheckoutAddressZip) return;
  lastCheckoutAddressZip = zip;
  setCheckoutAddressStatus("住所を検索しています...");

  try {
    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${encodeURIComponent(zip)}`);
    const data = await response.json();
    const address = data?.results?.[0];

    if (!address) {
      setCheckoutAddressStatus("住所が見つかりませんでした。手入力してください。", true);
      return;
    }

    if (stateInput) stateInput.value = address.address1 || "";
    if (cityInput) cityInput.value = address.address2 || "";
    if (line1Input && !line1Input.value.trim()) {
      line1Input.value = address.address3 || "";
      line1Input.focus();
    }

    setCheckoutAddressStatus("住所を自動入力しました。番地以降を入力してください。");
  } catch (error) {
    lastCheckoutAddressZip = "";
    setCheckoutAddressStatus("住所検索に失敗しました。手入力してください。", true);
  }
}

function showSitePopup(type, title, text) {
  let popup = document.querySelector("[data-site-popup]");
  if (!popup) {
    popup = document.createElement("div");
    popup.className = "site-popup";
    popup.dataset.sitePopup = "";
    popup.innerHTML = `
      <div class="site-popup__card" role="status" aria-live="polite">
        <button class="site-popup__close" type="button" aria-label="閉じる">×</button>
        <strong></strong>
        <p></p>
      </div>
    `;
    document.body.appendChild(popup);
    popup.querySelector("button")?.addEventListener("click", () => popup.classList.remove("is-visible"));
  }

  popup.classList.remove("is-success", "is-error");
  popup.classList.add(type === "error" ? "is-error" : "is-success", "is-visible");
  popup.querySelector("strong").textContent = title;
  popup.querySelector("p").textContent = text;
  window.clearTimeout(sitePopupTimer);
  sitePopupTimer = window.setTimeout(() => popup.classList.remove("is-visible"), 6400);
}

const chatbotAnswers = [
  {
    keywords: ["配送", "発送", "いつ", "届", "納期", "6月", "送料", "運送", "宅配"],
    title: "発送予定について",
    text: "送料は全国一律無料です。発送は2026年6月22日より順次予定しており、ヤマト運輸・佐川急便・日本郵便など当社指定の配送業者でお届けします。",
  },
  {
    keywords: ["支払い", "決済", "カード", "paypay", "銀行", "stripe", "visa", "master", "jcb", "amex", "discover", "diners"],
    title: "お支払い方法について",
    text: "先行予約ボタンを押すと、SSL暗号化通信に対応したStripeの安全な決済画面へ移動します。クレジット・デビットカード、銀行振込、PayPayから選択できます。決済情報はStripeで安全に処理されます。",
  },
  {
    keywords: ["返品", "交換", "不良", "破損", "キャンセル", "保証"],
    title: "返品・初期不良について",
    text: "返品・交換は商品到着後10日以内にメール（ikemen@kamacrafy.com）またはLINEで事前連絡があった未使用品のみ対応します。初期不良や配送時破損は良品交換または返金で対応します。注文後のキャンセルはお受けできません。",
  },
  {
    keywords: ["機内", "飛行機", "持ち込み", "航空", "lcc", "jal", "ana", "peach", "jetstar"],
    title: "機内持ち込みについて",
    text: "外寸は49×32×15〜20cmで、一般的な機内持ち込み目安に対応しています。ただし航空会社・座席種別・拡張時の厚みにより規定が異なるため、搭乗前に各社規定をご確認ください。",
  },
  {
    keywords: ["pc", "パソコン", "ノート", "インチ"],
    title: "PC収納について",
    text: "13〜17インチのPC収納に対応しています。背面側の独立PCポケットに、衝撃吸収素材ありで収納できます。",
  },
  {
    keywords: ["圧縮", "真空", "容量", "60l", "32l", "拡張", "マチ", "荷物", "収納", "入る"],
    title: "真空圧縮・容量について",
    text: "普段使いは約32L、拡張時は最大約60Lです。圧縮スペースに衣類を入れて密閉し、Type-C充電後に圧縮ボタンを押すと圧縮が開始されます。",
  },
  {
    keywords: ["雨", "防水", "濡", "撥水"],
    title: "雨の日の使用について",
    text: "防水性のある高密度オックスフォード生地が水を弾きます。移動中に雨が降ってきても、通り雨程度なら問題ありません。",
  },
  {
    keywords: ["価格", "値段", "金額", "クーポン", "割引", "5000", "15000", "29800", "54600"],
    title: "価格・特典割引について",
    text: "通常価格は34,800円です。特典適用で1個購入は5,000円OFFの29,800円、2個購入は15,000円OFFの54,600円です。先着55個限定の特典枠はなくなり次第終了します。",
  },
  {
    keywords: ["予約", "販売", "発売", "開始", "5月31", "21時", "先行"],
    title: "先行販売について",
    text: "VBP101は2026年5月31日21:00に先行販売開始予定です。先行予約ページから購入内容とお届け先を確認し、Stripe決済画面へ進めます。",
  },
  {
    keywords: ["101", "限定", "ロット", "受注", "生産", "なぜ"],
    title: "101個限定の理由について",
    text: "初回販売分は、品質を守りながら確実にお届けするため、数量を限定した受注生産形式で用意しています。VBP101の名にちなみ、初回ロットは101個限定です。",
  },
  {
    keywords: ["amazon", "楽天", "他で", "買え", "独占", "ページ限定"],
    title: "販売ページについて",
    text: "VBP101はこのページ限定の先行販売です。Amazon・楽天では購入できません。先行予約はLP内の赤いCTAボタン、またはSECURE CHECKOUTページから進めます。",
  },
  {
    keywords: ["サイズ", "外寸", "寸法", "大きさ", "49", "32", "15", "20"],
    title: "サイズについて",
    text: "外寸は49×32×15〜20cmです。拡張により厚みが変わるため、荷物量や航空会社の規定に合わせてご確認ください。",
  },
  {
    keywords: ["重さ", "重量", "軽い", "1.7"],
    title: "重量について",
    text: "重量は約1.7kgです。大容量・圧縮・TSAロック・PC収納などの機能を備えつつ、出張や旅行で持ち運びやすい設計です。",
  },
  {
    keywords: ["素材", "オックスフォード", "生地", "高密度"],
    title: "素材について",
    text: "素材は防水性のある高密度オックスフォード素材です。水を弾きやすく、移動中の通り雨程度であれば中身を気にしにくい仕様です。",
  },
  {
    keywords: ["tsa", "ロック", "鍵", "盗難", "セキュリティ"],
    title: "TSAロック・セキュリティについて",
    text: "TSAロックを搭載しており、移動中の荷物の不安を減らします。セキュリティポケットやPC収納も備え、出張時の貴重品管理をサポートします。",
  },
  {
    keywords: ["スーツケース", "キャリー", "ベルト", "固定"],
    title: "スーツケースベルトについて",
    text: "背面のスーツケースベルトでキャリーケースにしっかり固定できます。空港や駅での移動をスムーズにするための機能です。",
  },
  {
    keywords: ["背負", "肩", "疲れ", "人間工学", "快適", "リュック紐"],
    title: "背負い心地について",
    text: "背負い心地に配慮したショルダー設計で、出張や旅行の長時間移動でも疲れにくい使用感を目指しています。",
  },
  {
    keywords: ["傘", "ボトル", "スマホ", "フロント", "ポケット", "取り出"],
    title: "細かな収納について",
    text: "フロント収納、ボトル・傘収納、スマホ収納、セキュリティポケットなど、移動中に必要なものをすぐ取り出せる収納を備えています。",
  },
  {
    keywords: ["usb", "type-c", "充電", "バッテリー", "電源"],
    title: "圧縮機能の電源について",
    text: "真空圧縮はType-C充電した状態で圧縮ボタンを押すと開始されます。圧縮スペースを密閉し、ある程度バルブから空気を抜いてから操作してください。",
  },
  {
    keywords: ["ブランド", "vulkit", "物語", "ストーリー", "開発", "なぜ作った"],
    title: "ブランド・開発ストーリーについて",
    text: "VBP101は、出張時のスーツケース運搬、荷物整理、盗難不安、PC携帯、雨の日の備えをリュック1つで解決するために企画されたバックパックです。移動の負担を減らし、到着後すぐ動けることを目指しています。",
  },
  {
    keywords: ["会社", "販売業者", "住所", "代表", "連絡先", "メール"],
    title: "販売者情報について",
    text: "販売業者はKamaCrafy、運営責任者は鎌倉 匠吾です。所在地は埼玉県新座市菅沢1-3-36、連絡先はikemen@kamacrafy.comです。",
  },
  {
    keywords: ["中国", "製造国", "製造"],
    title: "製造国について",
    text: "製造国は中国です。初回販売分は製品状態を丁寧に確認しながら、数量を限定した受注生産形式でお届けします。",
  },
  {
    keywords: ["メール", "通知", "登録", "迷惑", "受信許可"],
    title: "メール通知について",
    text: "LINEを使わない方はメール通知登録をご利用ください。販売開始や特典情報をメールでお知らせします。受信漏れ防止のため「ikemen@kamacrafy.com」を受信許可設定してください。",
  },
  {
    keywords: ["line", "相談", "問い合わせ", "質問", "連絡"],
    title: "LINE相談について",
    text: "細かい確認や個別相談は、チャット内の「LINEで相談」ボタンからVULKIT VBP101公式LINEへお進みください。",
  },
];

function appendChatbotMessage(role, title, text) {
  if (!chatbotMessages) return;
  const message = document.createElement("article");
  message.className = `lp-chatbot__message lp-chatbot__message--${role}`;
  const heading = document.createElement("strong");
  const body = document.createElement("span");
  heading.textContent = title;
  body.textContent = text;
  message.append(heading, body);
  chatbotMessages.appendChild(message);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
}

function findChatbotAnswer(question) {
  const normalized = String(question || "").toLowerCase();
  return (
    chatbotAnswers.find((answer) => answer.keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()))) || {
      title: "個別に確認します",
      text: "その内容はLINEでご相談いただくと確実です。画面下の「LINEで相談」からお問い合わせください。先行予約前の不安もそのまま送っていただけます。",
    }
  );
}

function getChatbotSessionId() {
  const storageKey = "vulkit.chatbot.session";
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch (error) {
    if (!window.__vulkitChatbotSessionId) {
      window.__vulkitChatbotSessionId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    return window.__vulkitChatbotSessionId;
  }
}

function logChatbotMessage(question, answer) {
  chatbotLogCounter += 1;
  const payload = {
    ...getTrackingParams(),
    chat_session_id: getChatbotSessionId(),
    message_index: chatbotLogCounter,
    cta_location: "chatbot",
    question: String(question || "").slice(0, 500),
    answer_title: String(answer?.title || "").slice(0, 120),
    answer_text: String(answer?.text || "").slice(0, 600),
  };

  fetch("/api/chatbot-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function askChatbot(question) {
  const trimmed = String(question || "").trim();
  if (!trimmed) return;
  appendChatbotMessage("user", "質問", trimmed);
  const answer = findChatbotAnswer(trimmed);
  logChatbotMessage(trimmed, answer);
  window.setTimeout(() => appendChatbotMessage("bot", answer.title, answer.text), 180);
  if (window.VulkitAnalytics) {
    window.VulkitAnalytics.track("chatbot_question", {
      cta_location: "chatbot",
      question: trimmed.slice(0, 80),
      answer_title: answer.title,
    });
  }
}

function setChatbotOpen(isOpen) {
  chatbot?.classList.toggle("is-open", Boolean(isOpen));
  chatbotToggle?.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (isOpen) {
    window.setTimeout(() => chatbotInput?.focus(), 120);
    if (window.VulkitAnalytics) {
      window.VulkitAnalytics.track("chatbot_open", { cta_location: "chatbot" });
    }
  }
}

function keepElementInViewport(left, top, width, height, padding = 8) {
  const maxLeft = Math.max(padding, window.innerWidth - width - padding);
  const maxTop = Math.max(padding, window.innerHeight - height - padding);

  return {
    left: Math.min(Math.max(padding, left), maxLeft),
    top: Math.min(Math.max(padding, top), maxTop),
  };
}

function applyChatbotPosition(left, top) {
  if (!chatbot) return;
  const rect = chatbot.getBoundingClientRect();
  const position = keepElementInViewport(left, top, rect.width, rect.height);
  chatbot.classList.add("is-positioned");
  chatbot.style.left = `${position.left}px`;
  chatbot.style.top = `${position.top}px`;
  chatbot.style.right = "auto";
  chatbot.style.bottom = "auto";
}

function saveChatbotPosition() {
  if (!chatbot) return;
  const rect = chatbot.getBoundingClientRect();
  try {
    window.localStorage.setItem(
      "vulkit.chatbot.position",
      JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })
    );
  } catch (error) {}
}

function restoreChatbotPosition() {
  if (!chatbot) return;
  try {
    const saved = JSON.parse(window.localStorage.getItem("vulkit.chatbot.position") || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      applyChatbotPosition(saved.left, saved.top);
    }
  } catch (error) {}
}

restoreChatbotPosition();

chatbotToggle?.addEventListener("pointerdown", (event) => {
  if (!chatbot) return;
  const rect = chatbot.getBoundingClientRect();
  chatbotDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    moved: false,
  };
  chatbotToggle.setPointerCapture?.(event.pointerId);
  chatbot.classList.add("is-dragging");
});

chatbotToggle?.addEventListener("pointermove", (event) => {
  if (!chatbot || !chatbotDrag || chatbotDrag.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - chatbotDrag.startX;
  const deltaY = event.clientY - chatbotDrag.startY;
  if (Math.hypot(deltaX, deltaY) < 6 && !chatbotDrag.moved) return;

  event.preventDefault();
  chatbotDrag.moved = true;
  chatbotWasDragged = true;

  applyChatbotPosition(event.clientX - chatbotDrag.offsetX, event.clientY - chatbotDrag.offsetY);
});

function endChatbotDrag(event) {
  if (!chatbotDrag || chatbotDrag.pointerId !== event.pointerId) return;
  chatbotToggle?.releasePointerCapture?.(event.pointerId);
  chatbot?.classList.remove("is-dragging");
  if (chatbotDrag.moved) saveChatbotPosition();
  chatbotDrag = null;

  if (chatbotWasDragged) {
    window.setTimeout(() => {
      chatbotWasDragged = false;
    }, 0);
  }
}

chatbotToggle?.addEventListener("pointerup", endChatbotDrag);
chatbotToggle?.addEventListener("pointercancel", endChatbotDrag);

chatbotToggle?.addEventListener(
  "click",
  (event) => {
    if (!chatbotWasDragged) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true
);

window.addEventListener("resize", () => {
  if (!chatbot?.classList.contains("is-positioned")) return;
  const rect = chatbot.getBoundingClientRect();
  applyChatbotPosition(rect.left, rect.top);
  saveChatbotPosition();
});

chatbotToggle?.addEventListener("click", () => {
  setChatbotOpen(!chatbot?.classList.contains("is-open"));
});

chatbotClose?.addEventListener("click", () => setChatbotOpen(false));

document.querySelectorAll("[data-chatbot-question]").forEach((button) => {
  button.addEventListener("click", () => askChatbot(button.dataset.chatbotQuestion || button.textContent));
});

chatbotForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  askChatbot(chatbotInput?.value || "");
  if (chatbotInput) chatbotInput.value = "";
});

function showTop(index) {
  topVisuals[activeTop]?.classList.remove("is-active");
  activeTop = index % topVisuals.length;
  topVisuals[activeTop]?.classList.add("is-active");
}

function nextSection() {
  const sections = [...document.querySelectorAll("main > section")];
  const current = window.scrollY + 90;
  const next = sections.find((section) => section.offsetTop > current) || sections[0];
  window.scrollTo({ top: next.offsetTop - 64, behavior: "smooth" });
}

scrollButton?.addEventListener("click", nextSection);

floatingCouponClose?.addEventListener("click", () => {
  floatingCoupon?.classList.add("is-hidden");
  window.clearTimeout(floatingCouponTimer);
  floatingCouponTimer = window.setTimeout(() => {
    floatingCoupon?.classList.remove("is-hidden");
  }, 60000);
});

function keepCouponInViewport(left, top, width, height) {
  const padding = 8;
  const maxLeft = Math.max(padding, window.innerWidth - width - padding);
  const maxTop = Math.max(padding, window.innerHeight - height - padding);

  return {
    left: Math.min(Math.max(padding, left), maxLeft),
    top: Math.min(Math.max(padding, top), maxTop),
  };
}

floatingCoupon?.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".mobile-floating-coupon__close")) return;

  const rect = floatingCoupon.getBoundingClientRect();
  floatingCouponDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    moved: false,
  };
  floatingCoupon.setPointerCapture?.(event.pointerId);
  floatingCoupon.classList.add("is-dragging");
});

floatingCoupon?.addEventListener("pointermove", (event) => {
  if (!floatingCouponDrag || floatingCouponDrag.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - floatingCouponDrag.startX;
  const deltaY = event.clientY - floatingCouponDrag.startY;
  if (Math.hypot(deltaX, deltaY) < 6 && !floatingCouponDrag.moved) return;

  event.preventDefault();
  floatingCouponDrag.moved = true;
  floatingCouponWasDragged = true;

  const position = keepCouponInViewport(
    event.clientX - floatingCouponDrag.offsetX,
    event.clientY - floatingCouponDrag.offsetY,
    floatingCouponDrag.width,
    floatingCouponDrag.height
  );

  floatingCoupon.classList.add("is-positioned");
  floatingCoupon.style.left = `${position.left}px`;
  floatingCoupon.style.top = `${position.top}px`;
  floatingCoupon.style.right = "auto";
  floatingCoupon.style.bottom = "auto";
});

function endFloatingCouponDrag(event) {
  if (!floatingCouponDrag || floatingCouponDrag.pointerId !== event.pointerId) return;
  floatingCoupon.releasePointerCapture?.(event.pointerId);
  floatingCoupon.classList.remove("is-dragging");
  floatingCouponDrag = null;

  if (floatingCouponWasDragged) {
    window.setTimeout(() => {
      floatingCouponWasDragged = false;
    }, 0);
  }
}

floatingCoupon?.addEventListener("pointerup", endFloatingCouponDrag);
floatingCoupon?.addEventListener("pointercancel", endFloatingCouponDrag);

floatingCoupon?.addEventListener(
  "click",
  (event) => {
    if (!floatingCouponWasDragged) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true
);

if (topVisuals.length > 1) {
  window.setInterval(() => showTop(activeTop + 1), 2500);
}

if (youtubeFrames.length) {
  forceMuteEmbeddedMedia();
  window.setInterval(forceMuteEmbeddedMedia, 3000);
  window.addEventListener("focus", forceMuteEmbeddedMedia);
  document.addEventListener("visibilitychange", forceMuteEmbeddedMedia);
}

function updateCountdown(block) {
  const target = new Date(block.dataset.countdownTarget).getTime();
  const remaining = target - Date.now();
  const daysEl = block.querySelector("[data-countdown-days]");
  const hoursEl = block.querySelector("[data-countdown-hours]");
  const minutesEl = block.querySelector("[data-countdown-minutes]");
  const secondsEl = block.querySelector("[data-countdown-seconds]");

  if (!Number.isFinite(target)) return;

  if (remaining <= 0) {
    block.classList.add("is-ended");
    const note = block.querySelector(".launch-countdown__note");
    if (daysEl) daysEl.textContent = "00";
    if (hoursEl) hoursEl.textContent = "00";
    if (minutesEl) minutesEl.textContent = "00";
    if (secondsEl) secondsEl.textContent = "00";
    if (note) note.textContent = "先行販売を開始しました。特典枠は終了次第、通常価格に切り替わります。";
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");

  if (daysEl) daysEl.textContent = pad(days);
  if (hoursEl) hoursEl.textContent = pad(hours);
  if (minutesEl) minutesEl.textContent = pad(minutes);
  if (secondsEl) secondsEl.textContent = pad(seconds);
}

if (countdownBlocks.length) {
  const tickCountdowns = () => countdownBlocks.forEach(updateCountdown);
  tickCountdowns();
  window.setInterval(tickCountdowns, 1000);
}

function updateStockAlert(alert, total, remaining) {
  const count = alert.querySelector("[data-benefit-stock-count]");
  const bar = alert.querySelector(".benefit-stock-alert__bar span");
  const percentage = total > 0 ? Math.min(100, Math.round((remaining / total) * 100)) : 0;

  alert.dataset.benefitStockTotal = String(total);
  alert.dataset.benefitStockRemaining = String(remaining);
  if (count) count.textContent = String(remaining);
  if (bar) bar.style.width = `${percentage}%`;
  alert.classList.toggle("is-sold-out", remaining <= 0);
}

stockAlerts.forEach((alert) => {
  const total = Number(alert.dataset.benefitStockTotal || 55);
  const remaining = Math.max(0, Number(alert.dataset.benefitStockRemaining || 0));
  updateStockAlert(alert, total, remaining);
});

async function refreshBenefitStock() {
  if (!stockAlerts.length) return;

  try {
    const total = Number(stockAlerts[0]?.dataset.benefitStockTotal || 55);
    const response = await fetch(`/api/stock?total=${encodeURIComponent(total)}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) return;

    const nextTotal = Number(data.total || total);
    const nextRemaining = Math.max(0, Number(data.remaining || 0));
    stockAlerts.forEach((alert) => updateStockAlert(alert, nextTotal, nextRemaining));
  } catch (error) {
    // Static fallback remains visible if the stock API is unavailable.
  }
}

refreshBenefitStock();
window.setInterval(refreshBenefitStock, 60000);

function getTrackingParams() {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  const variantFromPath = path.includes("/lp-a")
    ? "lp-a"
    : path.includes("/lp-b")
      ? "lp-b"
      : path.includes("/lp-c")
        ? "lp-c"
        : "control";

  return {
    lp_variant: params.get("lp_variant") || variantFromPath,
    page_path: path,
    page_url: window.location.href,
    referrer: document.referrer,
    device: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_content: params.get("utm_content") || "",
    utm_term: params.get("utm_term") || "",
    utm_id: params.get("utm_id") || "",
    adset: params.get("adset") || "",
    ad: params.get("ad") || "",
    creative: params.get("creative") || "",
  };
}

function buildSecureCheckoutUrl(link) {
  const destination = new URL(link.getAttribute("href") || "/secure-checkout.html", window.location.origin);
  const currentParams = new URLSearchParams(window.location.search);
  const tracking = getTrackingParams();

  currentParams.forEach((value, key) => {
    if (!destination.searchParams.has(key)) {
      destination.searchParams.set(key, value);
    }
  });

  if (!destination.searchParams.has("lp_variant")) {
    destination.searchParams.set("lp_variant", tracking.lp_variant);
  }

  if (link.dataset.ctaLocation) {
    destination.searchParams.set("cta_location", link.dataset.ctaLocation);
  }

  destination.searchParams.set("from", tracking.page_path || "/");
  return destination.toString();
}

checkoutEntryLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const destination = buildSecureCheckoutUrl(link);
    link.href = destination;

    if (window.VulkitAnalytics) {
      window.VulkitAnalytics.track("reserve_cta_click", {
        ...getTrackingParams(),
        cta_location: link.dataset.ctaLocation || "reserve",
      });
    }

    window.setTimeout(() => {
      window.location.href = destination;
    }, 350);
  });
});

checkoutButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const originalText = button.querySelector("em")?.textContent || "";
    const customer = getCheckoutCustomerPrefill();
    if (customer === false) return;

    const payload = {
      ...getTrackingParams(),
      plan: button.dataset.checkoutPlan || "single",
      cta_location: button.dataset.ctaLocation || "checkout",
      customer,
    };

    checkoutButtons.forEach((item) => {
      item.disabled = true;
      item.classList.add("is-loading");
    });
    const label = button.querySelector("em");
    if (label) label.textContent = "決済画面を準備中...";

    if (window.VulkitAnalytics) {
      window.VulkitAnalytics.track("reserve_click", payload);
    }

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.message || data.error || "Checkout failed");
      }
      window.location.href = data.url;
    } catch (error) {
      checkoutButtons.forEach((item) => {
        item.disabled = false;
        item.classList.remove("is-loading");
      });
      if (label) label.textContent = originalText;
      window.alert("決済画面の準備に失敗しました。時間をおいて再度お試しください。");
    }
  });
});

if (checkoutPrefillForm) {
  const zipInput = checkoutPrefillForm.querySelector('input[name="postal_code"]');
  checkoutPrefillForm.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.value.trim()) {
        setCheckoutFieldError(input, false);
      }
    });
  });
  zipInput?.addEventListener("input", () => {
    window.clearTimeout(checkoutAddressTimer);
    checkoutAddressTimer = window.setTimeout(autofillCheckoutAddress, 360);
  });
  zipInput?.addEventListener("blur", autofillCheckoutAddress);
}

emailSignupForms.forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector('input[type="email"]');
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-email-signup-message]");
    const email = input?.value.trim() || "";
    const originalText = button?.textContent || "";

    if (!email || !isValidEmailInput(email)) {
      const errorText = "メールアドレスの形式を確認してください。";
      if (message) message.textContent = errorText;
      showSitePopup("error", "登録できませんでした", errorText);
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "登録中...";
    }
    if (message) message.textContent = "";

    try {
      const response = await fetch("/api/email-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...getTrackingParams(),
          email,
          cta_location: form.dataset.ctaLocation || "email_signup",
          section_id: form.dataset.sectionId || "email_signup",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "subscribe failed");
      form.classList.add("is-success");
      const successText = "登録ありがとうございます。先行販売情報をメールでお届けします。迷惑メール対策として ikemen@kamacrafy.com を受信許可してください。";
      if (message) message.textContent = successText;
      showSitePopup("success", "メール通知登録が完了しました", successText);
      if (window.VulkitAnalytics) {
        window.VulkitAnalytics.track("email_subscribe_success", {
          cta_location: form.dataset.ctaLocation || "email_signup",
          section_id: form.dataset.sectionId || "email_signup",
        });
      }
      if (input) input.value = "";
    } catch (error) {
      const errorText = "登録に失敗しました。時間をおいて再度お試しください。";
      if (message) message.textContent = errorText;
      showSitePopup("error", "登録に失敗しました", errorText);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  });
});
