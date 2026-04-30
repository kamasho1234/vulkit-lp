# VULKIT LP Analytics Setup

LP別・CTA別・LINE登録クリックを管理するための計測基盤です。

## 追加されたもの

- `tracking.js`
  - `page_view`
  - `section_view`
  - `roulette_start`
  - `roulette_miss`
  - `roulette_win`
  - `coupon_modal_view`
  - `line_click`
- `/api/track`
  - LP上のイベントを受け取り、Supabaseに保存します。
- `/api/line-redirect`
  - LINE遷移前に `line_click` を保存し、`https://lin.ee/Qi4NUTn` にリダイレクトします。
- `analytics.html`
  - LP別、CTA別、広告キャンペーン別の簡易ダッシュボードです。

## Supabaseテーブル

Supabase SQL Editorで以下を実行してください。

```sql
create table if not exists public.lp_events (
  id bigserial primary key,
  event_id text unique,
  event_name text not null,
  occurred_at timestamptz not null,
  lp_variant text,
  cta_location text,
  section_id text,
  attempt integer,
  result_target text,
  page_path text,
  page_url text,
  referrer text,
  device text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  utm_id text,
  adset text,
  ad text,
  creative text,
  fbclid text,
  fbp text,
  fbc text,
  user_agent text,
  ip_hint text,
  created_at timestamptz default now()
);

create index if not exists lp_events_occurred_at_idx on public.lp_events (occurred_at desc);
create index if not exists lp_events_event_name_idx on public.lp_events (event_name);
create index if not exists lp_events_lp_variant_idx on public.lp_events (lp_variant);
create index if not exists lp_events_cta_location_idx on public.lp_events (cta_location);
create index if not exists lp_events_utm_campaign_idx on public.lp_events (utm_campaign);
```

## Vercel環境変数

Vercel Project Settings > Environment Variables に設定してください。

```txt
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxx
ANALYTICS_ADMIN_KEY=任意の管理画面キー
```

`ANALYTICS_ADMIN_KEY` を設定した場合、管理画面は以下で開きます。

```txt
https://vulkit.kamacrafy.com/analytics.html?key=設定したキー
```

## ABテストURL例

Meta広告の遷移先に `lp_variant` とUTMを付けます。

```txt
https://vulkit.kamacrafy.com/?lp_variant=a&utm_source=meta&utm_medium=paid_social&utm_campaign=vbp101_launch_a
https://vulkit.kamacrafy.com/?lp_variant=b&utm_source=meta&utm_medium=paid_social&utm_campaign=vbp101_launch_b
```

## CTA位置

現在のCTA ID:

- `header`
- `footer`
- `roulette_coupon`

LINE登録リンクは `/api/line-redirect` 経由で計測されます。
