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
let activeTop = 0;
let floatingCouponTimer;
let floatingCouponDrag;
let floatingCouponWasDragged = false;
let sitePopupTimer;
let checkoutAddressTimer;
let lastCheckoutAddressZip = "";

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
