(function () {
  const LINE_URL = "https://lin.ee/6xr7cz7";
  const STORAGE_KEY = "vulkit.analytics.events";
  const MAX_LOCAL_EVENTS = 500;
  const VISITED_SECTIONS = new Set();

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

  function sendToAdTools(eventName, payload) {
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

  document.addEventListener("DOMContentLoaded", () => {
    setupLineLinks();
    setupCtaLinks();
    setupSectionTracking();
    track("page_view");
  });
})();
