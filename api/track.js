const ALLOWED_EVENTS = new Set([
  "page_view",
  "section_view",
  "roulette_start",
  "roulette_miss",
  "roulette_win",
  "coupon_modal_view",
  "line_click",
]);

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const adminKey = process.env.ANALYTICS_ADMIN_KEY;
  if (!adminKey) return false;
  return req.headers["x-analytics-key"] === adminKey;
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

function normalizeEvent(input, req) {
  const eventName = cleanText(input.event_name, 64);
  if (!ALLOWED_EVENTS.has(eventName)) return null;

  return {
    event_id: cleanText(input.event_id, 80) || `${Date.now()}-${Math.random()}`,
    event_name: eventName,
    occurred_at: cleanText(input.occurred_at, 40) || new Date().toISOString(),
    lp_variant: cleanText(input.lp_variant, 80) || "control",
    cta_location: cleanText(input.cta_location, 80),
    section_id: cleanText(input.section_id, 80),
    attempt: Number(input.attempt || 0),
    result_target: cleanText(input.result_target, 40),
    page_path: cleanText(input.page_path, 240),
    page_url: cleanText(input.page_url, 600),
    referrer: cleanText(input.referrer, 600),
    device: cleanText(input.device, 40),
    utm_source: cleanText(input.utm_source, 120),
    utm_medium: cleanText(input.utm_medium, 120),
    utm_campaign: cleanText(input.utm_campaign, 180),
    utm_content: cleanText(input.utm_content, 180),
    utm_term: cleanText(input.utm_term, 180),
    utm_id: cleanText(input.utm_id, 180),
    adset: cleanText(input.adset, 180),
    ad: cleanText(input.ad, 180),
    creative: cleanText(input.creative, 180),
    fbclid: cleanText(input.fbclid, 500),
    fbp: cleanText(input.fbp, 120),
    fbc: cleanText(input.fbc, 240),
    user_agent: cleanText(input.user_agent || req.headers["user-agent"], 600),
    ip_hint: cleanText(req.headers["x-forwarded-for"] || "", 120),
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
    const message = await response.text();
    throw new Error(message || `Supabase insert failed: ${response.status}`);
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
    const body = await parseBody(req);
    const event = normalizeEvent(body, req);
    if (!event) {
      send(res, 400, { ok: false, error: "Invalid event" });
      return;
    }

    const storage = await insertSupabase(event);
    send(res, storage.configured ? 201 : 202, {
      ok: true,
      stored: storage.configured,
      event_id: event.event_id,
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Tracking failed",
      ...(authorized(req) ? { detail: error.message } : {}),
    });
  }
};
