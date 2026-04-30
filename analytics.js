const STORAGE_KEY = "vulkit.analytics.events";
const statusCard = document.querySelector("#status-card");
const daysSelect = document.querySelector("#days-select");
const refreshButton = document.querySelector("#refresh-button");
const exportButton = document.querySelector("#export-button");

let latestRows = [];

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function int(value) {
  return new Intl.NumberFormat("ja-JP").format(value || 0);
}

function readLocalEvents() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (error) {
    return [];
  }
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
    row.section_view = (row.section_view || 0) + (event.event_name === "section_view" ? 1 : 0);
    row.cvr = row.page_view ? row.line_click / row.page_view : 0;
    rows.set(id, row);
  });
  return [...rows.values()].sort((a, b) => b.line_click - a.line_click || b.events - a.events);
}

function summarizeLocal(events) {
  const totals = {
    events: events.length,
    page_view: 0,
    section_view: 0,
    line_click: 0,
    roulette_start: 0,
    roulette_win: 0,
    coupon_modal_view: 0,
  };

  events.forEach((event) => {
    if (Object.prototype.hasOwnProperty.call(totals, event.event_name)) totals[event.event_name] += 1;
  });
  totals.line_click_cvr = totals.page_view ? totals.line_click / totals.page_view : 0;
  totals.roulette_win_rate = totals.roulette_start ? totals.roulette_win / totals.roulette_start : 0;

  return {
    stored: false,
    totals,
    by_lp: groupBy(events, ["lp_variant"]),
    by_cta: groupBy(events, ["cta_location"]),
    by_campaign: groupBy(events, ["utm_campaign"]),
    by_lp_cta: groupBy(events, ["lp_variant", "cta_location"]),
    by_section: groupBy(events, ["section_id"]),
    recent: events.slice(-100).reverse(),
  };
}

function cell(value, className = "") {
  return `<td class="${className}">${value}</td>`;
}

function renderRows(target, rows, template, emptyColumns) {
  const body = document.querySelector(target);
  if (!rows.length) {
    body.innerHTML = `<tr><td class="muted" colspan="${emptyColumns}">データがありません</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(template).join("");
}

function renderKpis(totals) {
  document.querySelector("#kpi-grid").innerHTML = [
    ["LP訪問", int(totals.page_view)],
    ["LINEクリック", int(totals.line_click)],
    ["LINEクリックCVR", pct(totals.line_click_cvr || 0)],
    ["ルーレット開始", int(totals.roulette_start)],
    ["当たり表示", int(totals.roulette_win)],
    ["クーポン表示", int(totals.coupon_modal_view)],
    ["セクション到達", int(totals.section_view)],
    ["総イベント", int(totals.events)],
  ]
    .map(([label, value]) => `
      <article class="kpi-card">
        <p>${label}</p>
        <strong>${value}</strong>
      </article>
    `)
    .join("");
}

function render(data) {
  renderKpis(data.totals);

  renderRows("#lp-table", data.by_lp, (row) => `
    <tr>
      ${cell(row.lp_variant)}
      ${cell(int(row.page_view))}
      ${cell(int(row.line_click), "positive")}
      ${cell(pct(row.cvr))}
      ${cell(int(row.roulette_start))}
      ${cell(int(row.roulette_win))}
    </tr>
  `, 6);

  renderRows("#cta-table", data.by_cta, (row) => `
    <tr>
      ${cell(row.cta_location)}
      ${cell(int(row.line_click), "positive")}
      ${cell(int(row.events))}
    </tr>
  `, 3);

  renderRows("#lp-cta-table", data.by_lp_cta, (row) => `
    <tr>
      ${cell(row.lp_variant)}
      ${cell(row.cta_location)}
      ${cell(int(row.page_view))}
      ${cell(int(row.line_click), "positive")}
      ${cell(pct(row.cvr))}
      ${cell(int(row.coupon_modal_view))}
    </tr>
  `, 6);

  renderRows("#campaign-table", data.by_campaign, (row) => `
    <tr>
      ${cell(row.utm_campaign)}
      ${cell(int(row.page_view))}
      ${cell(int(row.line_click), "positive")}
      ${cell(pct(row.cvr))}
    </tr>
  `, 4);

  renderRows("#section-table", data.by_section, (row) => `
    <tr>
      ${cell(row.section_id)}
      ${cell(int(row.section_view || row.events))}
    </tr>
  `, 2);

  latestRows = data.recent || [];
}

async function load() {
  statusCard.textContent = "読み込み中...";
  const days = daysSelect.value;
  const key = new URLSearchParams(window.location.search).get("key") || sessionStorage.getItem("analytics_key") || "";
  if (key) sessionStorage.setItem("analytics_key", key);

  try {
    const response = await fetch(`/api/analytics?days=${days}${key ? `&key=${encodeURIComponent(key)}` : ""}`);
    if (!response.ok) throw new Error("API unavailable");
    const data = await response.json();
    render(data);
    statusCard.textContent = data.stored
      ? `Supabase保存データを表示中。直近${data.days}日 / ${int(data.totals.events)}イベント`
      : "保存先が未設定です。現在はこのブラウザ内のローカル確認データを表示します。";
    if (!data.stored) render(summarizeLocal(readLocalEvents()));
  } catch (error) {
    const local = summarizeLocal(readLocalEvents());
    render(local);
    statusCard.textContent = "API未接続のため、このブラウザ内のローカル確認データを表示しています。";
  }
}

function exportCsv() {
  const headers = [
    "occurred_at",
    "event_name",
    "lp_variant",
    "cta_location",
    "section_id",
    "utm_campaign",
    "utm_source",
    "device",
    "page_path",
  ];
  const rows = latestRows.map((row) => headers.map((key) => `"${String(row[key] || "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vulkit-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

refreshButton.addEventListener("click", load);
daysSelect.addEventListener("change", load);
exportButton.addEventListener("click", exportCsv);
load();
