function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const adminKey = process.env.ANALYTICS_ADMIN_KEY;
  if (!adminKey) return false;
  return req.query?.key === adminKey || req.headers["x-analytics-key"] === adminKey;
}

async function deleteTestData() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");

  const endpoint = new URL(`${url.replace(/\/$/, "")}/rest/v1/lp_events`);
  endpoint.searchParams.set(
    "or",
    "(lp_variant.eq.codex_test,utm_campaign.eq.codex_test_campaign,event_id.like.codex-test-*)",
  );

  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  if (!authorized(req)) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const deleted = await deleteTestData();
    send(res, 200, {
      ok: true,
      deleted_count: deleted.length,
      deleted,
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Cleanup failed",
    });
  }
};
