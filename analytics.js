const STORAGE_KEY = "vulkit.analytics.events";
const SITE_URL = "https://vulkit.kamacrafy.com/";

const statusCard = document.querySelector("#status-card");
const daysSelect = document.querySelector("#days-select");
const refreshButton = document.querySelector("#refresh-button");
const exportButton = document.querySelector("#export-button");
const lpInput = document.querySelector("#lp-input");
const campaignInput = document.querySelector("#campaign-input");
const contentInput = document.querySelector("#content-input");
const adsetInput = document.querySelector("#adset-input");
const adInput = document.querySelector("#ad-input");
const generatedUrl = document.querySelector("#generated-url");
const copyUrlButton = document.querySelector("#copy-url-button");

let latestRows = [];

const CTA_LABELS = {
  header: "ヘッダーのLINE登録ボタン",
  footer: "最下部のLINEで情報GETボタン",
  roulette_coupon: "ルーレット当たり後のクーポン獲得ボタン",
  "(未設定)": "ボタン位置なし",
  unknown: "不明なLINE登録ボタン",
};

const SECTION_LABELS = {
  top: "TOP画像",
  "top-showcase": "TOP画像",
  compression: "拡張・真空圧縮",
  lock: "TSAロック",
  waterproof: "防水紹介",
  "coupon-roulette": "割引ルーレット",
  features: "機能紹介",
  brand: "ブランド紹介",
  scene: "使用シーン",
  details: "詳細情報",
  faq: "よくある質問",
  "closing-section": "最下部LINE登録CTA",
  "image-section": "画像セクション",
  "section-intro": "説明テキスト",
  "(未設定)": "位置情報なし",
};

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function int(value) {
  return new Intl.NumberFormat("ja-JP").format(value || 0);
}

function safe(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ctaLabel(value) {
  return CTA_LABELS[value] || value || "ボタン位置なし";
}

function sectionLabel(value) {
  return SECTION_LABELS[value] || value || "位置情報なし";
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
    const id = keys.map((key) => event[key] || "(未設定)").join("||");
    const row = rows.get(id) || Object.fromEntries(keys.map((key) => [key, event[key] || "(未設定)"]));
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
  return [...rows.values()].sort((a, b) => b.line_click - a.line_click || b.page_view - a.page_view || b.events - a.events);
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
  totals.roulette_start_rate = totals.page_view ? totals.roulette_start / totals.page_view : 0;
  totals.coupon_view_rate = totals.roulette_win ? totals.coupon_modal_view / totals.roulette_win : 0;

  return {
    stored: false,
    days: Number(daysSelect.value),
    totals,
    by_lp: groupBy(events, ["lp_variant"]),
    by_cta: groupBy(events, ["cta_location"]),
    by_campaign: groupBy(events, ["utm_campaign"]),
    by_funnel: groupBy(events, ["utm_campaign", "adset", "ad", "lp_variant"]),
    by_lp_cta: groupBy(events, ["lp_variant", "cta_location"]),
    by_section: groupBy(events, ["section_id"]),
    by_lp_section: groupBy(events, ["lp_variant", "section_id"]),
    recent: events.slice(-100).reverse(),
  };
}

function cell(value, className = "") {
  return `<td class="${className}">${safe(value)}</td>`;
}

function renderRows(target, rows, template, emptyColumns) {
  const body = document.querySelector(target);
  if (!rows.length) {
    body.innerHTML = `<tr><td class="muted" colspan="${emptyColumns}">まだデータがありません</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(template).join("");
}

function renderKpis(totals) {
  document.querySelector("#kpi-grid").innerHTML = [
    ["LP訪問", int(totals.page_view), "広告からLPに到達した回数"],
    ["LINEクリック", int(totals.line_click), "LINE登録ボタンを押した回数"],
    ["LINEクリックCVR", pct(totals.line_click_cvr || 0), "LINEクリック ÷ LP訪問"],
    ["ルーレット開始", int(totals.roulette_start), "抽選ボタンが押された回数"],
    ["当たり表示", int(totals.roulette_win), "2回目当たりまで到達した回数"],
    ["クーポン表示", int(totals.coupon_modal_view), "クーポン画面が表示された回数"],
    ["セクション到達", int(totals.section_view), "各セクションが見られた回数"],
    ["総イベント", int(totals.events), "保存された計測イベント総数"],
  ]
    .map(([label, value, help]) => `
      <article class="kpi-card">
        <p>${label}</p>
        <strong>${value}</strong>
        <small>${help}</small>
      </article>
    `)
    .join("");
}

function bestRow(rows, metric) {
  return [...rows].filter((row) => row[metric] > 0).sort((a, b) => b[metric] - a[metric])[0];
}

function renderInsights(data) {
  const bestLpByCvr = [...data.by_lp].filter((row) => row.page_view > 0).sort((a, b) => b.cvr - a.cvr)[0];
  const bestCta = bestRow(data.by_cta, "line_click");
  const bestCampaign = [...data.by_campaign].filter((row) => row.page_view > 0 && row.utm_campaign !== "(未設定)").sort((a, b) => b.cvr - a.cvr)[0];
  const lineCvr = data.totals.line_click_cvr || 0;

  const items = [
    bestLpByCvr
      ? [`勝ちLP候補: ${safe(bestLpByCvr.lp_variant)}`, `LINEクリックCVRは ${pct(bestLpByCvr.cvr)} です。訪問数が十分に増えたら、このLPを基準に次のABテストを作ります。`]
      : ["まずLP別URLを作成", "上のURL作成欄でMeta広告用URLを作り、広告のウェブサイトURLに設定してください。"],
    bestCta
      ? [`強いLINE登録ボタン: ${safe(ctaLabel(bestCta.cta_location))}`, `${int(bestCta.line_click)}件のLINEクリックがあります。この位置のボタンを目立たせる改善が有効です。`]
      : ["LINE登録ボタン計測待ち", "LINE登録ボタンが押されると、ヘッダー・フッター・ルーレット後の位置別に表示されます。"],
    bestCampaign
      ? [`良いキャンペーン: ${safe(bestCampaign.utm_campaign)}`, `キャンペーン別CVRは ${pct(bestCampaign.cvr)} です。Meta上のキャンペーン名とUTMを揃えると見やすくなります。`]
      : ["キャンペーン識別待ち", "Meta広告URLに `utm_campaign` を付けると、キャンペーン別に比較できます。"],
    lineCvr >= 0.08
      ? ["CVR良好", `全体のLINEクリックCVRは ${pct(lineCvr)} です。次は広告費を入れてCPAを見ます。`]
      : ["改善ポイント", `全体のLINEクリックCVRは ${pct(lineCvr)} です。FV訴求・ルーレット導線・CTA位置を優先して検証します。`],
  ];

  document.querySelector("#insight-list").innerHTML = items
    .map(([title, body]) => `
      <div class="insight-item">
        <i class="insight-dot" aria-hidden="true"></i>
        <div>
          <strong>${title}</strong>
          <span>${body}</span>
        </div>
      </div>
    `)
    .join("");
}

function render(data) {
  renderKpis(data.totals);
  renderInsights(data);

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
      ${cell(ctaLabel(row.cta_location))}
      ${cell(int(row.line_click), "positive")}
      ${cell(int(row.events))}
    </tr>
  `, 3);

  renderRows("#lp-cta-table", data.by_lp_cta, (row) => `
    <tr>
      ${cell(row.lp_variant)}
      ${cell(ctaLabel(row.cta_location))}
      ${cell(int(row.page_view))}
      ${cell(int(row.line_click), "positive")}
      ${cell(pct(row.cvr))}
      ${cell(int(row.coupon_modal_view))}
    </tr>
  `, 6);

  renderRows("#funnel-table", data.by_funnel || [], (row) => `
    <tr>
      ${cell(row.utm_campaign)}
      ${cell(row.adset)}
      ${cell(row.ad)}
      ${cell(row.lp_variant)}
      ${cell(int(row.page_view))}
      ${cell(int(row.line_click), "positive")}
      ${cell(pct(row.cvr))}
      ${cell(int(row.roulette_start))}
      ${cell(int(row.coupon_modal_view))}
    </tr>
  `, 9);

  renderRows("#campaign-table", data.by_campaign, (row) => `
    <tr>
      ${cell(row.utm_campaign)}
      ${cell(int(row.page_view))}
      ${cell(int(row.line_click), "positive")}
      ${cell(pct(row.cvr))}
    </tr>
  `, 4);

  renderRows("#lp-section-table", data.by_lp_section || [], (row) => `
    <tr>
      ${cell(row.lp_variant)}
      ${cell(sectionLabel(row.section_id))}
      ${cell(int(row.section_view || row.events))}
    </tr>
  `, 3);

  latestRows = data.recent || [];
}

function updateGeneratedUrl() {
  const url = new URL(SITE_URL);
  url.searchParams.set("lp_variant", lpInput.value.trim() || "lp_a");
  url.searchParams.set("utm_source", "meta");
  url.searchParams.set("utm_medium", "paid_social");
  url.searchParams.set("utm_campaign", campaignInput.value.trim() || "vbp101_presale");
  url.searchParams.set("utm_content", contentInput.value.trim() || "creative_01");
  url.searchParams.set("adset", adsetInput.value.trim() || "adset_01");
  url.searchParams.set("ad", adInput.value.trim() || "ad_01");
  generatedUrl.value = url.toString();
}

async function copyGeneratedUrl() {
  updateGeneratedUrl();
  try {
    await navigator.clipboard.writeText(generatedUrl.value);
    copyUrlButton.textContent = "コピー済み";
    window.setTimeout(() => {
      copyUrlButton.textContent = "コピー";
    }, 1400);
  } catch (error) {
    generatedUrl.select();
  }
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
      : "保存先が未設定です。このブラウザ内のローカル確認データを表示します。";
    if (!data.stored) render(summarizeLocal(readLocalEvents()));
  } catch (error) {
    const local = summarizeLocal(readLocalEvents());
    render(local);
    statusCard.textContent = "APIに接続できないため、このブラウザ内のローカル確認データを表示しています。";
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
    "utm_content",
    "utm_source",
    "adset",
    "ad",
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

[lpInput, campaignInput, contentInput, adsetInput, adInput].forEach((input) => input.addEventListener("input", updateGeneratedUrl));
copyUrlButton.addEventListener("click", copyGeneratedUrl);
refreshButton.addEventListener("click", load);
daysSelect.addEventListener("change", load);
exportButton.addEventListener("click", exportCsv);

updateGeneratedUrl();
load();
