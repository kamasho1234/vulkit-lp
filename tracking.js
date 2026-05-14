(function () {
  const LINE_URL = "https://lin.ee/6xr7cz7";
  const STORAGE_KEY = "vulkit.analytics.events";
  const MAX_LOCAL_EVENTS = 500;
  const VISITED_SECTIONS = new Set();
  const GOOGLE_ADS_ID = "AW-18159426814";
  const TIKTOK_PIXEL_ID = "D82KNMRC77U1B74FLJ8G";
  const GOOGLE_CONVERSIONS = {
    line_click: "AW-18159426814/aM9yCMiBzKwcEP65i9ND",
    reserve_click: "AW-18159426814/19LbCMuu46wcEP65i9ND",
    email_subscribe_success: "AW-18159426814/PZYwCOS146wcEP65i9ND",
    purchase_success: "AW-18159426814/1aq7CK3w5awcEP65i9ND",
  };
  const TIKTOK_EVENTS = {
    line_click: "Contact",
    reserve_click: "InitiateCheckout",
    email_subscribe_success: "CompleteRegistration",
    purchase_success: "CompletePayment",
  };

  function initGoogleTag() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () {
      window.dataLayer.push(arguments);
    };

    if (!document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}"]`)) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
      document.head.appendChild(script);
    }

    if (!window.__vulkitGoogleAdsConfigured) {
      window.gtag("js", new Date());
      window.gtag("config", GOOGLE_ADS_ID);
      window.__vulkitGoogleAdsConfigured = true;
    }
  }

  function initTikTokPixel() {
    if (window.__vulkitTikTokConfigured) return;

    (function (w, d, t) {
      w.TiktokAnalyticsObject = t;
      const ttq = (w[t] = w[t] || []);
      ttq.methods = [
        "page",
        "track",
        "identify",
        "instances",
        "debug",
        "on",
        "off",
        "once",
        "ready",
        "alias",
        "group",
        "enableCookie",
        "disableCookie",
        "holdConsent",
        "revokeConsent",
        "grantConsent",
      ];
      ttq.setAndDefer = function (target, method) {
        target[method] = function () {
          target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (let i = 0; i < ttq.methods.length; i += 1) {
        ttq.setAndDefer(ttq, ttq.methods[i]);
      }
      ttq.instance = function (pixelId) {
        const instance = ttq._i[pixelId] || [];
        for (let i = 0; i < ttq.methods.length; i += 1) {
          ttq.setAndDefer(instance, ttq.methods[i]);
        }
        return instance;
      };
      ttq.load = function (pixelId, options) {
        const url = "https://analytics.tiktok.com/i18n/pixel/events.js";
        const script = d.createElement("script");
        ttq._i = ttq._i || {};
        ttq._i[pixelId] = [];
        ttq._i[pixelId]._u = url;
        ttq._t = ttq._t || {};
        ttq._t[pixelId] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[pixelId] = options || {};
        script.type = "text/javascript";
        script.async = true;
        script.src = `${url}?sdkid=${pixelId}&lib=${t}`;
        const firstScript = d.getElementsByTagName("script")[0];
        firstScript.parentNode.insertBefore(script, firstScript);
      };
      ttq.load(TIKTOK_PIXEL_ID);
      ttq.page();
    })(window, document, "ttq");

    window.__vulkitTikTokConfigured = true;
  }

  function getQuery() {
    return new URLSearchParams(window.location.search);
  }

  function getCookie(name) {
    return document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");
  }

  function getLpVariant() {
    const params = getQuery();
    const fromQuery = params.get("lp_variant") || params.get("variant");
    if (fromQuery) return fromQuery;

    const pathVariant = window.location.pathname.match(/^\/(?:lp\/)?([a-z0-9-]+)\/?$/i);
    if (pathVariant && !["api", "assets"].includes(pathVariant[1])) return pathVariant[1];

    return document.body.dataset.lpVariant || "control";
  }

  function getUtmContext() {
    const params = getQuery();
    const context = {
      lp_variant: getLpVariant(),
      page_path: window.location.pathname,
      page_url: window.location.href,
      referrer: document.referrer || "",
      device: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
      user_agent: navigator.userAgent,
      fbclid: params.get("fbclid") || "",
      fbp: getCookie("_fbp") || "",
      fbc: getCookie("_fbc") || "",
    };

    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "adset", "ad", "creative"].forEach((key) => {
      context[key] = params.get(key) || "";
    });

    return context;
  }

  function readLocalEvents() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (error) {
      return [];
    }
  }

  function writeLocalEvent(event) {
    try {
      const events = readLocalEvents();
      events.push(event);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_LOCAL_EVENTS)));
    } catch (error) {
      // localStorage can be unavailable in private contexts. Network tracking still runs.
    }
  }

  function sendToServer(event) {
    if (!/^https?:$/.test(window.location.protocol)) return;

    const body = JSON.stringify(event);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }

    window.fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  function sendGoogleConversion(eventName, payload) {
    const sendTo = GOOGLE_CONVERSIONS[eventName];
    if (!sendTo || !window.gtag) return;

    const conversionPayload = {
      send_to: sendTo,
    };

    if (eventName === "purchase_success") {
      const value = Number(payload.value || 0);
      if (Number.isFinite(value) && value > 0) {
        conversionPayload.value = value;
      }
      conversionPayload.currency = payload.currency || "JPY";
      if (payload.transaction_id) {
        conversionPayload.transaction_id = String(payload.transaction_id);
      }
    }

    window.gtag("event", "conversion", conversionPayload);
  }

  function sendTikTokEvent(eventName, payload) {
    const tiktokEventName = TIKTOK_EVENTS[eventName];
    if (!tiktokEventName || !window.ttq) return;

    const eventPayload = {
      content_name: "VULKIT VBP101",
      content_type: "product",
      lp_variant: payload.lp_variant,
      cta_location: payload.cta_location,
    };

    if (eventName === "purchase_success") {
      const value = Number(payload.value || 0);
      if (Number.isFinite(value) && value > 0) {
        eventPayload.value = value;
      }
      eventPayload.currency = payload.currency || "JPY";
      if (payload.transaction_id) {
        eventPayload.order_id = String(payload.transaction_id);
      }
    }

    window.ttq.track(tiktokEventName, eventPayload);
  }

  function sendToAdTools(eventName, payload) {
    sendGoogleConversion(eventName, payload);
    sendTikTokEvent(eventName, payload);

    if (window.gtag) {
      window.gtag("event", eventName, payload);
    }

    if (window.fbq) {
      if (eventName === "line_click") {
        window.fbq("track", "Lead", {
          content_name: "line_registration",
          lp_variant: payload.lp_variant,
          cta_location: payload.cta_location,
        });
        return;
      }

      window.fbq("trackCustom", eventName, payload);
    }
  }

  function track(eventName, details = {}, options = {}) {
    const event = {
      event_id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      ...getUtmContext(),
      ...details,
    };

    writeLocalEvent(event);
    if (!options.skipServer) sendToServer(event);
    sendToAdTools(eventName, event);

    return event;
  }

  function buildLineRedirectUrl() {
    return LINE_URL;
  }

  function openLine({ ctaLocation = "unknown" } = {}) {
    track("line_click", { cta_location: ctaLocation });
    window.open(buildLineRedirectUrl(), "_blank", "noopener,noreferrer");
  }

  function setupLineLinks() {
    document.querySelectorAll("[data-line-cta]").forEach((link) => {
      const ctaLocation = link.dataset.lineCta || "unknown";
      link.href = buildLineRedirectUrl();
      link.addEventListener("click", () => {
        track("line_click", { cta_location: ctaLocation });
      });
    });
  }

  function setupCtaLinks() {
    document.querySelectorAll("[data-cta-location]").forEach((link) => {
      const ctaLocation = link.dataset.ctaLocation || "unknown";
      link.addEventListener("click", () => {
        track("cta_click", { cta_location: ctaLocation });
      });
    });
  }

  function setupPurchaseSuccessTracking() {
    const successPage = document.body.classList.contains("checkout-success-page");
    if (!successPage) return;

    const params = getQuery();
    const sessionId = params.get("session_id") || "";
    if (!sessionId) return;

    const storageKey = `vulkit.google_ads.purchase.${sessionId}`;
    try {
      if (window.localStorage.getItem(storageKey)) return;
      window.localStorage.setItem(storageKey, "1");
    } catch (error) {
      // If storage is unavailable, still track the purchase once for this load.
    }

    const plan = params.get("plan") || "single";
    const planValues = { single: 29800, double: 54600 };
    const value = Number(params.get("value") || planValues[plan] || 0);

    track("purchase_success", {
      cta_location: "checkout_success",
      result_target: plan,
      transaction_id: sessionId,
      value,
      currency: "JPY",
    });
  }

  function setupSectionTracking() {
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const section = entry.target;
          const sectionId = section.id || section.className.toString().split(" ")[0] || "section";
          if (VISITED_SECTIONS.has(sectionId)) return;
          VISITED_SECTIONS.add(sectionId);
          track("section_view", {
            section_id: sectionId,
          });
        });
      },
      { threshold: 0.45 },
    );

    document.querySelectorAll("main > section[id], main > section[class]").forEach((section) => {
      observer.observe(section);
    });
  }

  window.VulkitAnalytics = {
    buildLineRedirectUrl,
    lineUrl: LINE_URL,
    localStorageKey: STORAGE_KEY,
    openLine,
    readLocalEvents,
    track,
  };

  initGoogleTag();
  initTikTokPixel();

  document.addEventListener("DOMContentLoaded", () => {
    setupLineLinks();
    setupCtaLinks();
    setupSectionTracking();
    setupPurchaseSuccessTracking();
    track("page_view");
  });
})();
