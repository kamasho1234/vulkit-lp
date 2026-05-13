const EVENT_LIMIT = 10000;

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const adminKey = process.env.ANALYTICS_ADMIN_KEY;
  if (!adminKey) return true;
  const provided = req.query?.key || req.headers["x-analytics-key"];
  return provided === adminKey;
}

async function fetchSupabaseEvents(days) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, events: [] };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const endpoint = new URL(`${url.replace(/\/$/, "")}/rest/v1/lp_events`);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("occurred_at", `gte.${since}`);
  endpoint.searchParams.set("order", "occurred_at.desc");
  endpoint.searchParams.set("limit", String(EVENT_LIMIT));

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message}`);
  }

  return { configured: true, events: await response.json() };
}

function groupBy(events, keys) {
  const rows = new Map();

  events.forEach((event) => {
    const id = keys.map((key) => event[key] || "(none)").join("||");
    const row = rows.get(id) || Object.fromEntries(keys.map((key) => [key, event[key] || "(none)"]));
    row.events = (row.events || 0) + 1;
    row.page_view = (row.page_view || 0) + (event.event_name === "page_view" ? 1 : 0);
    row.line_click = (row.line_click || 0) + (event.event_name === "line_click" ? 1 : 0);
    row.roulette_start = (row.roulette_start || 0) + (event.event_name === "roulette_start" ? 1 : 0);
    row.roulette_win = (row.roulette_win || 0) + (event.event_name === "roulette_win" ? 1 : 0);
    row.coupon_modal_view = (row.coupon_modal_view || 0) + (event.event_name === "coupon_modal_view" ? 1 : 0);
    row.email_subscribe = (row.email_subscribe || 0) + (event.event_name === "email_subscribe" ? 1 : 0);
    row.cvr = row.page_view ? row.line_click / row.page_view : 0;
    rows.set(id, row);
  });

  return [...rows.values()].sort((a, b) => b.line_click - a.line_click || b.page_view - a.page_view);
}

function summarize(events) {
  const totals = {
    events: events.length,
    page_view: 0,
    section_view: 0,
    line_click: 0,
    roulette_start: 0,
    roulette_win: 0,
    coupon_modal_view: 0,
    email_subscribe: 0,
  };

  events.forEach((event) => {
    if (Object.prototype.hasOwnProperty.call(totals, event.event_name)) {
      totals[event.event_name] += 1;
    }
  });

  totals.line_click_cvr = totals.page_view ? totals.line_click / totals.page_view : 0;
  totals.email_subscribe_cvr = totals.page_view ? totals.email_subscribe / totals.page_view : 0;
  totals.roulette_win_rate = totals.roulette_start ? totals.roulette_win / totals.roulette_start : 0;

  const emailRows = new Map();
  events
    .filter((event) => event.event_name === "email_subscribe" && event.result_target)
    .forEach((event) => {
      const email = String(event.result_target || "").toLowerCase();
      const existing = emailRows.get(email);
      if (!existing || new Date(event.occurred_at) > new Date(existing.occurred_at)) {
        emailRows.set(email, event);
      }
    });

  return {
    totals,
    by_lp: groupBy(events, ["lp_variant"]),
    by_cta: groupBy(events, ["cta_location"]),
    by_campaign: groupBy(events, ["utm_campaign"]),
    by_creative: groupBy(events, ["utm_content"]),
    by_funnel: groupBy(events, ["utm_campaign", "adset", "utm_content", "ad", "lp_variant"]),
    by_lp_cta: groupBy(events, ["lp_variant", "cta_location"]),
    by_section: groupBy(events, ["section_id"]),
    by_lp_section: groupBy(events, ["lp_variant", "section_id"]),
    by_email_cta: groupBy(events.filter((event) => event.event_name === "email_subscribe"), ["cta_location"]),
    email_subscribers: [...emailRows.values()].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)),
    recent: events.slice(0, 100),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  if (!authorized(req)) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const days = Math.min(Number(req.query?.days || 30), 180);
    const storage = await fetchSupabaseEvents(days);
    send(res, 200, {
      ok: true,
      stored: storage.configured,
      days,
      ...summarize(storage.events),
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Analytics fetch failed",
    });
  }
};
