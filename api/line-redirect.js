const LINE_URL = "https://lin.ee/6xr7cz7";

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).slice(0, maxLength);
}

async function insertSupabase(event) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  await fetch(`${url.replace(/\/$/, "")}/rest/v1/lp_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(event),
  });
}

module.exports = async function handler(req, res) {
  const query = req.query || {};
  const event = {
    event_id: `${Date.now()}-${Math.random()}`,
    event_name: "line_click",
    occurred_at: new Date().toISOString(),
    lp_variant: cleanText(query.lp_variant, 80) || "control",
    cta_location: cleanText(query.cta_location, 80) || "unknown",
    page_path: cleanText(query.page_path, 240),
    referrer: cleanText(req.headers.referer, 600),
    device: cleanText(query.device, 40),
    utm_source: cleanText(query.utm_source, 120),
    utm_medium: cleanText(query.utm_medium, 120),
    utm_campaign: cleanText(query.utm_campaign, 180),
    utm_content: cleanText(query.utm_content, 180),
    utm_term: cleanText(query.utm_term, 180),
    utm_id: cleanText(query.utm_id, 180),
    adset: cleanText(query.adset, 180),
    ad: cleanText(query.ad, 180),
    creative: cleanText(query.creative, 180),
    fbclid: cleanText(query.fbclid, 500),
    fbp: cleanText(query.fbp, 120),
    fbc: cleanText(query.fbc, 240),
    user_agent: cleanText(req.headers["user-agent"], 600),
    ip_hint: cleanText(req.headers["x-forwarded-for"], 120),
  };

  try {
    await insertSupabase(event);
  } catch (error) {
    // Redirect must never fail for users. Storage errors are intentionally swallowed.
  }

  res.statusCode = 302;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", LINE_URL);
  res.end();
};
