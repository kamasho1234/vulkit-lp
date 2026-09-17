(() => {
  "use strict";

  const PRICE = 6810;
  const REGULAR_PRICE = 8620;
  const SHIPPING_FEE = 350;
  const FREE_SHIPPING_QUANTITY = 2;
  const CART_KEY = "vulkit.vb108.cart.v1";
  const CART_REVISION_KEY = "vulkit.vb108.cart.revision.v1";
  const colors = {
    greige: {
      name: "Greige",
      label: "グレージュ",
      number: "01",
      image: "/VB108/assets/vb108-greige.jpg"
    },
    caramel: {
      name: "Mocha Brown",
      label: "モカブラウン",
      number: "02",
      image: "/VB108/assets/vb108-caramel-brown.jpg"
    },
    black: {
      name: "Black",
      label: "黒",
      number: "03",
      image: "/VB108/assets/vb108-black-v129.jpg"
    }
  };

  const state = {
    color: "greige",
    quantity: 1,
    cart: loadCart()
  };

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const money = new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  });

  const purchaseImage = $("[data-purchase-image]");
  const selectedColor = $("[data-selected-color]");
  const quantityOutput = $("[data-quantity]");
  const cartFeedback = $("[data-cart-feedback]");
  const cartDialog = $("[data-cart-dialog]");
  const cartBody = $("[data-cart-body]");
  const cartTotal = $("[data-cart-total]");
  const cartSubtotal = $("[data-cart-subtotal]");
  const cartShipping = $("[data-cart-shipping]");
  const cartSavings = $("[data-cart-savings]");
  const cartShippingNote = $("[data-cart-shipping-note]");
  const cartStatus = $("[data-cart-status]");
  const checkoutButton = $("[data-checkout]");

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([key, quantity]) =>
            Object.hasOwn(colors, key) &&
            Number.isInteger(quantity) &&
            quantity > 0 &&
            quantity <= 5
        )
      );
    } catch {
      return {};
    }
  }

  function saveCart() {
    try {
      const serialized = JSON.stringify(state.cart);
      if (localStorage.getItem(CART_KEY) !== serialized || !localStorage.getItem(CART_REVISION_KEY)) {
        localStorage.setItem(CART_REVISION_KEY, globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      }
      localStorage.setItem(CART_KEY, serialized);
    } catch {
      // The visible cart still works when storage is unavailable.
    }
  }

  function normalizeQuantity(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 5) {
      throw new RangeError("数量は1〜5の整数で指定してください。");
    }
    return number;
  }

  function assertColor(value) {
    if (!Object.hasOwn(colors, value)) {
      throw new TypeError("カラーは greige、caramel、black のいずれかを指定してください。");
    }
    return value;
  }

  function setColor(key) {
    const safeKey = assertColor(key);
    const color = colors[safeKey];
    state.color = safeKey;

    if (purchaseImage) {
      purchaseImage.src = color.image;
      purchaseImage.alt = `VB108 ${color.label}`;
    }
    if (selectedColor) selectedColor.textContent = color.label;

    $$("[data-purchase-preview]").forEach((button) => {
      const active = button.dataset.purchasePreview === safeKey;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    $$('input[name="color"]').forEach((input) => {
      input.checked = input.value === safeKey;
      input.closest(".color-option")?.classList.toggle("is-selected", input.checked);
    });

    return color;
  }

  function setQuantity(value) {
    state.quantity = normalizeQuantity(value);
    if (quantityOutput) quantityOutput.textContent = String(state.quantity);
    const minusButton = $("[data-quantity-minus]");
    const plusButton = $("[data-quantity-plus]");
    if (minusButton) minusButton.disabled = state.quantity <= 1;
    if (plusButton) plusButton.disabled = state.quantity >= 5;
    return state.quantity;
  }

  function cartCount() {
    return Object.values(state.cart).reduce((sum, quantity) => sum + quantity, 0);
  }

  function cartSummary() {
    const items = Object.entries(state.cart).map(([key, quantity]) => ({
      color: key,
      colorLabel: colors[key].label,
      quantity,
      unitPrice: PRICE,
      regularUnitPrice: REGULAR_PRICE,
      subtotal: PRICE * quantity
    }));
    const itemCount = cartCount();
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const regularSubtotal = REGULAR_PRICE * itemCount;
    const shipping = itemCount === 0 || itemCount >= FREE_SHIPPING_QUANTITY ? 0 : SHIPPING_FEE;
    return {
      items,
      itemCount,
      subtotal,
      regularSubtotal,
      discountTotal: regularSubtotal - subtotal,
      shipping,
      total: subtotal + shipping,
      currency: "JPY",
      checkoutAvailable: itemCount > 0
    };
  }

  function renderCart() {
    const summary = cartSummary();
    if (checkoutButton) checkoutButton.disabled = !summary.checkoutAvailable;
    $$("[data-cart-count]").forEach((element) => {
      element.textContent = String(summary.itemCount);
    });

    if (!cartBody || !cartTotal) return summary;

    if (summary.items.length === 0) {
      cartBody.innerHTML =
        '<div class="empty-cart"><span aria-hidden="true">○</span><p>カートは空です。</p></div>';
    } else {
      cartBody.innerHTML = summary.items
        .map(({ color, colorLabel, quantity, unitPrice, subtotal }) => {
          const item = colors[color];
          return `
            <article class="cart-item">
              <img src="${item.image}" alt="VB108 ${colorLabel}">
              <div class="cart-item-info">
                <span>VULKIT VB108</span>
                <strong>${colorLabel}</strong>
                <small class="cart-unit-price">単価 ${money.format(unitPrice)}（税込）</small>
                <small class="cart-item-subtotal">小計 ${money.format(subtotal)}（税込）</small>
                <div class="stepper" role="group" aria-label="${colorLabel}の数量">
                  <button type="button" data-cart-action="decrease" data-color="${color}" aria-label="${colorLabel}を1点減らす">−</button>
                  <output aria-label="${colorLabel}の数量" aria-live="polite">${quantity}</output>
                  <button type="button" data-cart-action="increase" data-color="${color}" aria-label="${colorLabel}を1点増やす" ${quantity >= 5 ? "disabled" : ""}>＋</button>
                </div>
              </div>
              <button class="cart-remove" type="button" data-cart-action="remove" data-color="${color}" aria-label="${colorLabel}をカートから削除">削除</button>
            </article>
          `;
        })
        .join("");
    }

    cartTotal.textContent = money.format(summary.total);
    if (cartSubtotal) cartSubtotal.textContent = money.format(summary.subtotal);
    if (cartShipping) {
      cartShipping.textContent = summary.itemCount === 0
        ? "—"
        : summary.shipping === 0 ? "無料" : money.format(summary.shipping);
    }
    if (cartSavings) {
      cartSavings.textContent = summary.itemCount > 0
        ? `定価より ${money.format(summary.discountTotal)} お得`
        : "";
    }
    if (cartShippingNote) {
      cartShippingNote.textContent = summary.itemCount === 0
        ? "送料350円・2点以上のご購入で送料無料"
        : summary.itemCount < FREE_SHIPPING_QUANTITY
          ? "あと1点で送料無料です。"
          : "2点以上のご購入で送料無料です。";
    }
    saveCart();
    return summary;
  }

  function openCart() {
    renderCart();
    if (!cartDialog) return;
    if (typeof cartDialog.showModal === "function") {
      if (!cartDialog.open) cartDialog.showModal();
    } else {
      cartDialog.setAttribute("open", "");
    }
    $$("[data-cart-open]").forEach((button) => button.setAttribute("aria-expanded", "true"));
  }

  function closeCart() {
    if (!cartDialog) return;
    if (typeof cartDialog.close === "function") {
      if (cartDialog.open) cartDialog.close();
    } else {
      cartDialog.removeAttribute("open");
    }
    $$("[data-cart-open]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  checkoutButton?.addEventListener("click", () => {
    const summary = cartSummary();
    if (!summary.checkoutAvailable) return;
    saveCart();
    const query = new URLSearchParams();
    summary.items.forEach(({ color, quantity }) => query.set(color, String(quantity)));
    window.location.assign(`/VB108/checkout.html?${query}`);
  });

  function addToCart(color = state.color, quantity = state.quantity, show = true) {
    const safeColor = assertColor(color);
    const safeQuantity = normalizeQuantity(quantity);
    const nextQuantity = (state.cart[safeColor] || 0) + safeQuantity;
    if (nextQuantity > 5) {
      throw new RangeError("同じカラーは5点までカートに追加できます。");
    }
    state.cart[safeColor] = nextQuantity;
    const summary = renderCart();
    if (show) openCart();
    if (cartStatus) {
      cartStatus.textContent = `${colors[safeColor].label}を${safeQuantity}点追加しました。カートは合計${summary.itemCount}点です。`;
    }
    return summary;
  }

  $$("[data-purchase-preview]").forEach((button) => {
    button.addEventListener("click", () => setColor(button.dataset.purchasePreview));
  });

  $$('input[name="color"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setColor(input.value);
    });
  });

  $("[data-quantity-minus]")?.addEventListener("click", () => {
    setQuantity(Math.max(1, state.quantity - 1));
  });

  $("[data-quantity-plus]")?.addEventListener("click", () => {
    setQuantity(Math.min(5, state.quantity + 1));
  });

  $("[data-purchase-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (cartFeedback) cartFeedback.textContent = "";
    try {
      addToCart();
    } catch (error) {
      if (cartFeedback) cartFeedback.textContent = error.message;
    }
  });

  $$("[data-cart-open]").forEach((button) => {
    button.addEventListener("click", openCart);
  });

  $("[data-cart-close]")?.addEventListener("click", closeCart);

  cartDialog?.addEventListener("click", (event) => {
    if (event.target === cartDialog) closeCart();
  });

  cartDialog?.addEventListener("close", () => {
    $$("[data-cart-open]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  });

  cartBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-action]");
    if (!button) return;
    const color = assertColor(button.dataset.color);
    const action = button.dataset.cartAction;

    if (action === "remove") {
      delete state.cart[color];
    } else if (action === "increase") {
      state.cart[color] = Math.min(5, (state.cart[color] || 0) + 1);
    } else if (action === "decrease") {
      const next = (state.cart[color] || 0) - 1;
      if (next <= 0) delete state.cart[color];
      else state.cart[color] = next;
    }

    const summary = renderCart();
    if (cartStatus) {
      const itemUpdate = state.cart[color]
        ? `${colors[color].label}の数量を${state.cart[color]}点に変更しました。`
        : `${colors[color].label}をカートから削除しました。`;
      cartStatus.textContent = `${itemUpdate}カートは合計${summary.itemCount}点です。`;
    }
    requestAnimationFrame(() => {
      let nextAction = action;
      if (action === "increase" && state.cart[color] >= 5) nextAction = "decrease";
      const nextButton = cartBody.querySelector(
        `[data-cart-action="${nextAction}"][data-color="${color}"]`
      );
      (nextButton || $("[data-cart-close]"))?.focus();
    });
  });

  const header = $("[data-header]");
  const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const heroVideo = $("[data-hero-video]");
  const heroToggle = $("[data-hero-toggle]");
  if (heroVideo && heroToggle) {
    const heroStage = $("[data-hero-stage]");
    const heroCaption = $("[data-hero-caption]");
    const galleryButtons = $$("[data-hero-media]");
    const galleryPanels = $$("[data-hero-panel]");
    let activeMedia = "video";
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let playRequested = !motionPreference.matches;
    let heroVisible = true;
    let playbackFailed = false;
    heroVideo.muted = true;
    const updateVideoButton = () => {
      if (playbackFailed) return;
      const label = heroVideo.paused ? "動画を再生" : "動画を一時停止";
      heroToggle.dataset.playback = heroVideo.paused ? "paused" : "playing";
      heroToggle.setAttribute("aria-label", label);
      heroToggle.title = label;
    };
    const syncHeroPlayback = () => {
      if (playbackFailed) return;
      if (activeMedia === "video" && playRequested && heroVisible && !document.hidden) {
        void heroVideo.play().catch(() => updateVideoButton());
      } else {
        heroVideo.pause();
      }
      updateVideoButton();
    };
    galleryButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const nextMedia = button.dataset.heroMedia;
        if (!galleryPanels.some((panel) => panel.dataset.heroPanel === nextMedia)) return;
        activeMedia = nextMedia;
        galleryPanels.forEach((panel) => {
          panel.hidden = panel.dataset.heroPanel !== activeMedia;
        });
        galleryButtons.forEach((item) => {
          const selected = item.dataset.heroMedia === activeMedia;
          item.classList.toggle("is-active", selected);
          item.setAttribute("aria-pressed", String(selected));
        });
        heroToggle.hidden = activeMedia !== "video";
        if (heroCaption) heroCaption.textContent = button.dataset.caption;
        syncHeroPlayback();
      });
    });
    galleryPanels.filter((panel) => panel.tagName === "IMG").forEach((panel) => {
      panel.addEventListener("error", () => {
        if (panel.dataset.heroPanel === activeMedia && heroCaption) {
          heroCaption.textContent = "画像を読み込めませんでした。別の画像を選んでください。";
        }
      });
    });
    heroToggle.addEventListener("click", () => {
      playRequested = heroVideo.paused;
      syncHeroPlayback();
    });
    heroVideo.addEventListener("play", updateVideoButton);
    heroVideo.addEventListener("pause", updateVideoButton);
    heroVideo.addEventListener("error", () => {
      playbackFailed = true;
      heroToggle.dataset.playback = "error";
      heroToggle.setAttribute("aria-label", "動画を読み込めませんでした");
      heroToggle.title = "動画を読み込めませんでした";
      heroToggle.disabled = true;
      if (activeMedia === "video" && heroCaption) {
        heroCaption.textContent = "動画を読み込めませんでした。商品画像をご覧ください。";
      }
    });
    if (motionPreference.matches) heroVideo.removeAttribute("autoplay");
    motionPreference.addEventListener("change", (event) => {
      if (event.matches) {
        playRequested = false;
        heroVideo.removeAttribute("autoplay");
      }
      syncHeroPlayback();
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        heroVisible = entry.isIntersecting && entry.intersectionRatio >= 0.1;
        syncHeroPlayback();
      }, { threshold: 0.1 }).observe(heroStage || heroVideo);
    }
    document.addEventListener("visibilitychange", syncHeroPlayback);
    syncHeroPlayback();
  }
  if (!reducedMotion && "IntersectionObserver" in window) {
    document.documentElement.classList.add("motion-ready");
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    $$(".reveal").forEach((element) => revealObserver.observe(element));
  }

  const mobileBar = $("[data-mobile-bar]");
  const purchaseSection = $("#purchase");
  if (mobileBar && purchaseSection && "IntersectionObserver" in window) {
    const purchaseObserver = new IntersectionObserver(
      ([entry]) => {
        mobileBar.classList.toggle("is-hidden", entry.isIntersecting);
        mobileBar.toggleAttribute("inert", entry.isIntersecting);
        mobileBar.setAttribute("aria-hidden", String(entry.isIntersecting));
      },
      { threshold: 0.06 }
    );
    purchaseObserver.observe(purchaseSection);
  }

  const year = $("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  const legalToggle = $("[data-legal-toggle]");
  const legalPanel = $("#legal-commerce");
  legalToggle?.addEventListener("click", () => {
    if (!legalPanel) return;
    const expanded = legalToggle.getAttribute("aria-expanded") === "true";
    legalToggle.setAttribute("aria-expanded", String(!expanded));
    legalPanel.hidden = expanded;
  });

  async function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool) =>
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch((error) => {
        console.warn(`WebMCP tool registration failed: ${tool.name}`, error);
      });

    await Promise.all([
      register({
        name: "configure_vb108",
        title: "VB108のカラーと数量を選ぶ",
        description: "VB108の商品画面で販売カラーと数量を選択し、表示を更新します。カートには追加しません。",
        inputSchema: {
          type: "object",
          properties: {
            color: { type: "string", enum: ["greige", "caramel", "black"] },
            quantity: { type: "integer", minimum: 1, maximum: 5 }
          },
          required: ["color", "quantity"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object") throw new TypeError("入力が必要です。");
          const color = assertColor(input.color);
          const quantity = normalizeQuantity(input.quantity);
          setColor(color);
          setQuantity(quantity);
          $("#purchase")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
          return { color, colorLabel: colors[color].label, quantity };
        }
      }),
      register({
        name: "add_vb108_to_cart",
        title: "VB108をカートに入れる",
        description: "指定したVB108のカラーと数量をカートへ追加します。この操作では決済や注文は行いません。",
        inputSchema: {
          type: "object",
          properties: {
            color: { type: "string", enum: ["greige", "caramel", "black"] },
            quantity: { type: "integer", minimum: 1, maximum: 5 }
          },
          required: ["color", "quantity"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object") throw new TypeError("入力が必要です。");
          const color = assertColor(input.color);
          const quantity = normalizeQuantity(input.quantity);
          if ((state.cart[color] || 0) + quantity > 5) {
            throw new RangeError("同じカラーは5点までカートに追加できます。");
          }
          setColor(color);
          setQuantity(quantity);
          return addToCart(color, quantity, true);
        }
      }),
      register({
        name: "read_vb108_cart",
        title: "VB108のカート内容を確認",
        description: "画面上の確認用カートに入っているVB108のカラー、数量、合計予定価格を読み取ります。",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return cartSummary();
        }
      })
    ]);
  }

  // Keep the product-page cart aligned with edits made on the shipping page,
  // including when the browser restores this page from its back/forward cache.
  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY) { state.cart = loadCart(); renderCart(); }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) { state.cart = loadCart(); renderCart(); }
  });

  setColor(state.color);
  setQuantity(state.quantity);
  renderCart();
  void registerWebMcpTools();
})();
// Reviews use their own controls and modal; they never modify the purchase cart.
(() => {
  "use strict";
  const section = document.querySelector("#reviews");
  if (!section) return;
  const cards = [...section.querySelectorAll(".review-card")];
  const more = section.querySelector("[data-reviews-more]");
  const status = section.querySelector("[data-reviews-status]");
  let expanded = false;
  const updateCards = () => {
    cards.forEach(card => { card.hidden = !expanded && card.dataset.reviewInitial !== "true"; });
    const count = cards.filter(card => !card.hidden).length;
    if (more) {
      more.hidden = false;
      more.setAttribute("aria-expanded", String(expanded));
      more.textContent = expanded ? "最初の8件に戻す" : `もっと見る（全${cards.length}件）`;
    }
    if (status) status.textContent = `${cards.length}件中${count}件を表示`;
  };
  more?.addEventListener("click", () => {
    expanded = !expanded;
    updateCards();
  });
  updateCards();

  const dialog = document.querySelector("#review-media-dialog");
  if (!dialog || typeof dialog.showModal !== "function") return;
  const stage = dialog.querySelector("[data-review-media-stage]");
  const title = dialog.querySelector("#review-media-title");
  const counter = dialog.querySelector("[data-review-media-count]");
  const previous = dialog.querySelector("[data-review-media-prev]");
  const next = dialog.querySelector("[data-review-media-next]");
  let gallery = [];
  let position = 0;
  let opener = null;

  const clearMedia = () => {
    stage.querySelectorAll("video").forEach(video => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
    stage.replaceChildren();
  };
  const showMedia = () => {
    clearMedia();
    const link = gallery[position];
    if (!link) return;
    const thumbnail = link.querySelector("img");
    const isVideo = link.dataset.mediaKind === "video";
    const media = document.createElement(isVideo ? "video" : "img");
    if (isVideo) {
      media.controls = true;
      media.defaultMuted = true;
      media.muted = true;
      media.setAttribute("muted", "");
      media.playsInline = true;
      media.setAttribute("playsinline", "");
      media.preload = "metadata";
      media.poster = thumbnail.src;
      media.width = Number(link.dataset.mediaWidth);
      media.height = Number(link.dataset.mediaHeight);
      media.setAttribute("aria-label", link.dataset.mediaLabel);
      media.textContent = "お使いのブラウザは動画再生に対応していません。";
      // Playback starts only when the user presses the native play control.
    } else {
      media.alt = thumbnail.alt;
      media.width = Number(thumbnail.getAttribute("width"));
      media.height = Number(thumbnail.getAttribute("height"));
      media.srcset = thumbnail.srcset;
      media.sizes = "(max-width:700px) calc(100vw - 58px), 866px";
    }
    media.src = link.dataset.mediaSrc;
    stage.append(media);
    title.textContent = link.dataset.mediaLabel;
    counter.textContent = `${position + 1} / ${gallery.length}`;
    previous.disabled = position === 0;
    next.disabled = position === gallery.length - 1;
  };
  section.addEventListener("click", event => {
    const link = event.target.closest(".review-media-trigger");
    if (!link || !section.contains(link)) return;
    event.preventDefault();
    const card = link.closest(".review-card");
    // Only this review's own media participates in the enlarged gallery.
    gallery = [...card.querySelectorAll(".review-media-trigger")].filter(item => item.dataset.reviewId === card.dataset.reviewId);
    position = gallery.indexOf(link);
    if (position < 0) return;
    opener = link;
    showMedia();
    dialog.showModal();
  });
  previous.addEventListener("click", () => { if (position > 0) { position--; showMedia(); } });
  next.addEventListener("click", () => { if (position < gallery.length - 1) { position++; showMedia(); } });
  dialog.querySelector("[data-review-media-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    clearMedia();
    gallery = [];
    opener?.focus();
  });
})();
