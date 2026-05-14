const crypto = require("crypto");

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length > 1000000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseStripeSignature(header) {
  return String(header || "")
    .split(",")
    .reduce((result, part) => {
      const [key, value] = part.split("=");
      if (!key || !value) return result;
      if (!result[key]) result[key] = [];
      result[key].push(value);
      return result;
    }, {});
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  const signature = parseStripeSignature(signatureHeader);
  const timestamp = signature.t?.[0];
  const signatures = signature.v1 || [];
  if (!timestamp || signatures.length === 0) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return signatures.some((value) => {
    const left = Buffer.from(value, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).slice(0, maxLength);
}

function buildCheckoutEvent(base, overrides = {}) {
  return {
    ...base,
    ...overrides,
  };
}

async function insertSupabase(event) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false };

  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/lp_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return { configured: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
      send(res, 400, { ok: false, error: "Invalid Stripe signature" });
      return;
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const supported = new Set(["checkout.session.completed"]);
    if (!supported.has(event.type)) {
      send(res, 200, { ok: true, ignored: true });
      return;
    }

    const session = event.data?.object || {};
    const metadata = session.metadata || {};
    const baseEvent = {
      event_name: "stock_reserved",
      occurred_at: new Date((event.created || Date.now() / 1000) * 1000).toISOString(),
      lp_variant: cleanText(metadata.lp_variant, 80) || "control",
      cta_location: cleanText(metadata.cta_location, 80) || "stripe_checkout",
      attempt: Math.max(1, Number(metadata.quantity || 1)),
      page_path: cleanText(metadata.page_path, 240),
      utm_source: cleanText(metadata.utm_source, 120),
      utm_medium: cleanText(metadata.utm_medium, 120),
      utm_campaign: cleanText(metadata.utm_campaign, 180),
      utm_content: cleanText(metadata.utm_content, 180),
      utm_term: cleanText(metadata.utm_term, 180),
      utm_id: cleanText(metadata.utm_id, 180),
      adset: cleanText(metadata.adset, 180),
      ad: cleanText(metadata.ad, 180),
      creative: cleanText(metadata.creative, 180),
      result_target: cleanText(metadata.plan || session.id, 40),
      page_url: cleanText(session.url, 600),
    };

    await insertSupabase(
      buildCheckoutEvent(baseEvent, {
        event_id: cleanText(`stock_${session.id || event.id}`, 80),
      })
    );

    send(res, 200, { ok: true });
  } catch (error) {
    send(res, 500, { ok: false, error: "Webhook handling failed" });
  }
};
