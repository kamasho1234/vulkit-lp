const SITE_URL = "https://vulkit.kamacrafy.com";

const PLANS = {
  single: {
    quantity: 1,
    label: "VULKIT VBP101 1\u500b\u8cfc\u5165",
    unitAmount: 29800,
    regularAmount: 34800,
    discountAmount: 5000,
  },
  double: {
    quantity: 2,
    label: "VULKIT VBP101 2\u500b\u8cfc\u5165",
    unitAmount: 54600,
    regularAmount: 69600,
    discountAmount: 15000,
  },
};

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).slice(0, maxLength);
}

function appendParam(params, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    params.append(key, String(value));
  }
}

function getBaseUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.SITE_URL || SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function buildProductDescription(plan) {
  const regularAmount = plan.regularAmount.toLocaleString("ja-JP");
  const discountAmount = plan.discountAmount.toLocaleString("ja-JP");
  return `\u901a\u5e38\u4fa1\u683c${regularAmount}\u5186\u304b\u3089\u5148\u884c\u4e88\u7d04\u7279\u5178${discountAmount}\u5186\u5272\u5f15\u3092\u9069\u7528\u3002${plan.quantity}\u500b\u306e\u5148\u884c\u4e88\u7d04\u3002`;
}

async function createStripeSession({ req, plan, body }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { configured: false };
  }

  const baseUrl = getBaseUrl(req);
  const successUrl =
    process.env.STRIPE_SUCCESS_URL ||
    `${baseUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    process.env.STRIPE_CANCEL_URL ||
    `${baseUrl}/checkout-cancel.html?plan=${encodeURIComponent(body.plan || "single")}`;

  const params = new URLSearchParams();
  appendParam(params, "mode", "payment");
  appendParam(params, "success_url", successUrl);
  appendParam(params, "cancel_url", cancelUrl);
  appendParam(params, "automatic_payment_methods[enabled]", "true");
  appendParam(params, "billing_address_collection", "auto");
  appendParam(params, "phone_number_collection[enabled]", "true");
  appendParam(params, "shipping_address_collection[allowed_countries][0]", "JP");
  appendParam(params, "shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  appendParam(params, "shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
  appendParam(params, "shipping_options[0][shipping_rate_data][fixed_amount][currency]", "jpy");
  appendParam(params, "shipping_options[0][shipping_rate_data][display_name]", "\u5168\u56fd\u4e00\u5f8b\u9001\u6599\u7121\u6599");
  appendParam(params, "line_items[0][quantity]", "1");
  appendParam(params, "line_items[0][price_data][currency]", "jpy");
  appendParam(params, "line_items[0][price_data][unit_amount]", plan.unitAmount);
  appendParam(params, "line_items[0][price_data][product_data][name]", plan.label);
  appendParam(
    params,
    "line_items[0][price_data][product_data][description]",
    buildProductDescription(plan)
  );
  appendParam(
    params,
    "line_items[0][price_data][product_data][images][0]",
    `${baseUrl}/assets/lp/top/top-control-business-launch-20260531.png`
  );

  const metadata = {
    product: "VULKIT VBP101",
    plan: body.plan,
    quantity: String(plan.quantity),
    regular_amount: String(plan.regularAmount),
    discount_amount: String(plan.discountAmount),
    lp_variant: cleanText(body.lp_variant, 80) || "control",
    cta_location: cleanText(body.cta_location, 80),
    page_path: cleanText(body.page_path, 240),
    utm_source: cleanText(body.utm_source, 120),
    utm_medium: cleanText(body.utm_medium, 120),
    utm_campaign: cleanText(body.utm_campaign, 180),
    utm_content: cleanText(body.utm_content, 180),
    utm_term: cleanText(body.utm_term, 180),
    utm_id: cleanText(body.utm_id, 180),
    adset: cleanText(body.adset, 180),
    ad: cleanText(body.ad, 180),
    creative: cleanText(body.creative, 180),
  };

  Object.entries(metadata).forEach(([key, value]) => {
    appendParam(params, `metadata[${key}]`, value);
    appendParam(params, `payment_intent_data[metadata][${key}]`, value);
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Stripe error: ${response.status}`);
  }

  return { configured: true, session: data };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = await parseBody(req);
    const plan = PLANS[body.plan] || PLANS.single;
    const result = await createStripeSession({ req, plan, body });

    if (!result.configured) {
      send(res, 503, {
        ok: false,
        error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel.",
      });
      return;
    }

    send(res, 200, {
      ok: true,
      id: result.session.id,
      url: result.session.url,
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Checkout session creation failed",
      message: error.message,
    });
  }
};
