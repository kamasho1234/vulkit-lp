function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function getAdminKey() {
  return process.env.EMAIL_ADMIN_KEY || process.env.ANALYTICS_ADMIN_KEY || "";
}

function getRequestKey(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const headerKey = cleanText(req.headers["x-admin-key"], 200);
  return headerKey || cleanText(url.searchParams.get("key"), 200);
}

function toInteger(value, fallback, min, max) {
  const next = Number.parseInt(value, 10);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function buildSupabaseUrl(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const limit = toInteger(url.searchParams.get("limit"), 300, 1, 1000);

  const endpoint = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/lp_events`);
  endpoint.searchParams.set(
    "select",
    [
      "event_id",
      "occurred_at",
      "result_target",
      "section_id",
      "referrer",
      "creative",
      "lp_variant",
      "cta_location",
      "page_path",
      "page_url",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "utm_id",
      "adset",
      "ad",
      "device",
    ].join(",")
  );
  endpoint.searchParams.set("event_name", "eq.chatbot_message");
  endpoint.searchParams.set("order", "occurred_at.desc");
  endpoint.searchParams.set("limit", String(limit));

  return endpoint;
}

function getSessionId(eventId) {
  const value = cleanText(eventId, 240);
  const match = value.match(/^chat_(.+)_\d+_[a-f0-9]+$/i);
  return match ? match[1] : "";
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    occurred_at: row.occurred_at || "",
    chat_session_id: getSessionId(row.event_id),
    question: cleanText(row.result_target, 500),
    answer_title: cleanText(row.section_id, 120),
    answer_text: cleanText(row.referrer || row.creative, 600),
    lp_variant: row.lp_variant || "",
    cta_location: row.cta_location || "",
    page_path: row.page_path || "",
    page_url: row.page_url || "",
    utm_source: row.utm_source || "",
    utm_medium: row.utm_medium || "",
    utm_campaign: row.utm_campaign || "",
    utm_content: row.utm_content || "",
    utm_term: row.utm_term || "",
    utm_id: row.utm_id || "",
    adset: row.adset || "",
    ad: row.ad || "",
    device: row.device || "",
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const adminKey = getAdminKey();
  if (!adminKey || getRequestKey(req) !== adminKey) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    send(res, 503, { ok: false, error: "Supabase is not configured" });
    return;
  }

  try {
    const response = await fetch(buildSupabaseUrl(req), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const rows = normalizeRows(await response.json());
    const sessions = new Set(rows.map((row) => row.chat_session_id).filter(Boolean));

    send(res, 200, {
      ok: true,
      total_messages: rows.length,
      total_sessions: sessions.size,
      rows,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    send(res, 500, { ok: false, error: "Failed to load chatbot logs" });
  }
};
