(function (root, document) {
  "use strict";
  // Use the dedicated VB108 project only on public VB108 storefront pages.
  // Never record local/staging tests, payment results, or sensitive URL context.
  const pages = ["/VB108", "/VB108/", "/VB108/index.html", "/VB108/checkout.html"];
  if (root.location.protocol !== "https:" ||
      root.location.hostname !== "vulkit.kamacrafy.com" ||
      !pages.includes(root.location.pathname)) return;

  function sensitiveUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value);
      return /checkout-success(?:\.html)?\/?$/i.test(url.pathname) ||
        [...url.searchParams.keys()].some((key) =>
          /session|token|secret|email|phone|address|name|postal/i.test(key));
    } catch { return true; }
  }
  if (sensitiveUrl(root.location.href) || sensitiveUrl(document.referrer)) return;
  if (root.clarity) return;

  // Keep the project's consent settings; never manufacture visitor consent.
  root.clarity = function () {
    (root.clarity.q = root.clarity.q || []).push(arguments);
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.clarity.ms/tag/yps1duwgo1";
  script.referrerPolicy = "no-referrer";
  document.head.appendChild(script);
})(window, document);
