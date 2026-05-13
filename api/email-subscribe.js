const RESEND_API_KEY_ENV = "RESEND_API_KEY";

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
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
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

function welcomeEmailHtml(email) {
  const escapedEmail = email.replace(/[<>&"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
  })[char]);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VULKIT VBP101 メール通知登録完了</title>
  </head>
  <body style="margin:0;background:#f7f3ea;color:#161616;font-family:'Yu Mincho','Hiragino Mincho ProN',serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px 18px;">
      <div style="background:#ffffff;border:1px solid #dbc17d;border-radius:14px;overflow:hidden;box-shadow:0 18px 42px rgba(0,0,0,.08);">
        <div style="background:#070707;color:#f4d37a;padding:28px 24px;text-align:center;">
          <div style="font-size:24px;letter-spacing:.18em;font-weight:700;">VULKIT</div>
          <div style="margin-top:10px;color:#fff;font-size:18px;">VBP101 先行販売通知</div>
        </div>
        <div style="padding:28px 24px;line-height:1.9;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.45;color:#141414;">メール通知登録ありがとうございます。</h1>
          <p style="margin:0 0 16px;">VULKIT VBP101の先行販売開始・在庫情報・特典情報を、こちらのメールアドレスへお届けします。</p>
          <p style="margin:0 0 16px;">登録メールアドレス：<strong>${escapedEmail}</strong></p>
          <div style="margin:24px 0;padding:18px;border:1px solid #d8bd72;background:#fffaf0;border-radius:10px;">
            <strong style="display:block;margin-bottom:8px;color:#8a5d00;">迷惑メール対策のお願い</strong>
            <p style="margin:0;">大切なお知らせを確実に受け取れるよう、<strong>ikemen@kamacrafy.com</strong> からのメールを受信許可リストに追加してください。迷惑メールフォルダやプロモーションタブに振り分けられる場合があります。</p>
          </div>
          <p style="margin:0 0 16px;">先行販売ページ：<a href="https://vulkit.kamacrafy.com/" style="color:#8a5d00;font-weight:700;">https://vulkit.kamacrafy.com/</a></p>
          <p style="margin:0;">101個限定の先行販売に向けて、準備が整い次第ご案内します。今しばらく楽しみにお待ちください。</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function welcomeEmailText(email) {
  return [
    "VULKIT VBP101 メール通知登録ありがとうございます。",
    "",
    "VULKIT VBP101の先行販売開始・在庫情報・特典情報を、こちらのメールアドレスへお届けします。",
    `登録メールアドレス：${email}`,
    "",
    "迷惑メール対策のお願い",
    "大切なお知らせを確実に受け取れるよう、ikemen@kamacrafy.com からのメールを受信許可リストに追加してください。",
    "迷惑メールフォルダやプロモーションタブに振り分けられる場合があります。",
    "",
    "先行販売ページ：https://vulkit.kamacrafy.com/",
    "",
    "101個限定の先行販売に向けて、準備が整い次第ご案内します。",
    "今しばらく楽しみにお待ちください。",
    "",
    "KamaCrafy / VULKIT VBP101",
  ].join("\n");
}

async function sendWelcomeEmail(email) {
  const apiKey = process.env[RESEND_API_KEY_ENV];
  if (!apiKey) return { configured: false, sent: false };

  const from = process.env.EMAIL_FROM || "KamaCrafy <ikemen@kamacrafy.com>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      reply_to: "ikemen@kamacrafy.com",
      subject: "【VULKIT VBP101】メール通知登録が完了しました",
      html: welcomeEmailHtml(email),
      text: welcomeEmailText(email),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return { configured: true, sent: true };
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
    let mail = { configured: Boolean(process.env[RESEND_API_KEY_ENV]), sent: false };
    try {
      mail = await sendWelcomeEmail(email);
    } catch (mailError) {
      console.error("Welcome email failed", mailError);
    }
    send(res, storage.configured ? 201 : 202, {
      ok: true,
      stored: storage.configured,
      email_sent: mail.sent,
      email_configured: mail.configured,
    });
  } catch (error) {
    send(res, 500, {
      ok: false,
      error: "Email subscribe failed",
    });
  }
};
