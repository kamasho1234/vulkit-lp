const DEFAULT_TOTAL = 55;
const EVENT_LIMIT = 10000;

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function resolveQuantity(event) {
  const quantity = Number(event.attempt || 0);
  if (Number.isFinite(quantity) && quantity > 0) {
    return Math.min(2, Math.max(1, Math.round(quantity)));
  }

  const target = String(event.result_target || "").toLowerCase();
  if (target.includes("double") || target.includes("2")) return 2;
  return 1;
}

async function fetchCheckoutEvents() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, events: [] };

  const endpoint = new URL(`${url.replace(/\/$/, "")}/rest/v1/lp_events`);
  endpoint.searchParams.set("select", "event_id,event_name,result_target,attempt,occurred_at");
  endpoint.searchParams.set("event_name", "eq.stock_reserved");
  endpoint.searchParams.set("order", "occurred_at.desc");
  endpoint.searchParams.set("limit", String(EVENT_LIMIT));

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return { configured: true, events: await response.json() };
}

function summarizeStock(events, total) {
  const seen = new Set();
  let sold = 0;

  events.forEach((event) => {
    const id = event.event_id || `${event.occurred_at}-${event.result_target}`;
    if (seen.has(id)) return;
    seen.add(id);
    sold += resolveQuantity(event);
  });

  const cappedSold = Math.min(total, Math.max(0, sold));
  return {
    total,
    sold: cappedSold,
    remaining: Math.max(0, total - cappedSold),
    raw_sold: sold,
    unique_orders: seen.size,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const requestedTotal = Number(req.query?.total || DEFAULT_TOTAL);
    const total = Number.isFinite(requestedTotal) ? Math.max(1, requestedTotal) : DEFAULT_TOTAL;
    const storage = await fetchCheckoutEvents();
    const stock = summarizeStock(storage.events, total);

    send(res, 200, {
      ok: true,
      stored: storage.configured,
      ...stock,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Stock fetch failed",
      total: DEFAULT_TOTAL,
      remaining: DEFAULT_TOTAL,
    });
  }
};
