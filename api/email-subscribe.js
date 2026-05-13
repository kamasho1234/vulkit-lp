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
      if (data.length > 50000) {
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
  return String(value).trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      send(res, 400, { ok: false, error: "Invalid email" });
      return;
    }

    const now = new Date().toISOString();
    const event = {
      event_id: `email_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      event_name: "email_subscribe",
      occurred_at: now,
      lp_variant: cleanText(body.lp_variant, 80) || "control",
      cta_location: cleanText(body.cta_location, 80) || "email_signup",
      section_id: cleanText(body.section_id, 80) || "email_signup",
      result_target: email,
      page_path: cleanText(body.page_path, 240),
      page_url: cleanText(body.page_url, 600),
      referrer: cleanText(body.referrer, 600),
      device: cleanText(body.device, 40),
      utm_source: cleanText(body.utm_source, 120),
      utm_medium: cleanText(body.utm_medium, 120),
      utm_campaign: cleanText(body.utm_campaign, 180),
      utm_content: cleanText(body.utm_content, 180),
      utm_term: cleanText(body.utm_term, 180),
      utm_id: cleanText(body.utm_id, 180),
      adset: cleanText(body.adset, 180),
      ad: cleanText(body.ad, 180),
      creative: cleanText(body.creative, 180),
      user_agent: cleanText(req.headers["user-agent"], 600),
      ip_hint: cleanText(req.headers["x-forwarded-for"], 120),
    };

    const storage = await insertSupabase(event);
    send(res, storage.configured ? 201 : 202, {
      ok: true,
      stored: storage.configured,
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Email subscribe failed",
    });
  }
};
