
# TradingView → SharkExchange Auto-Trader

A single-user web app that receives TradingView alert webhooks, applies risk rules, and places orders on SharkExchange via its REST API. Includes a dashboard with kill switch, trade history, P&L, and paper-trading mode.

## ⚠️ One thing I need from you before/while building

I couldn't find public API docs for "SharkExchange". Please share:
- Link to their REST API docs
- Auth scheme (API key + secret? HMAC signature? Passphrase?)
- Endpoints for: place order, cancel order, get balances, get positions, get order status

I'll scaffold the app with a clean `SharkExchangeClient` interface. Once you send docs, I'll fill in the signing + endpoints. If you have paper/testnet URLs, share those too.

## Architecture

```text
TradingView alert
      │  (JSON webhook + shared secret)
      ▼
POST /api/public/webhook/tradingview
      │  verify secret → parse signal → risk checks
      ▼
Trade engine (server fn)
      │  → SharkExchangeClient  ──► SharkExchange REST API
      │  → Supabase (trades, positions, settings, logs)
      ▼
Dashboard (React, live via Supabase realtime)
```

## Features

**Webhook receiver** — `/api/public/webhook/tradingview` (public prefix so TradingView can reach it). Verifies a shared secret in the JSON body, validates schema with Zod, dedupes by alert ID.

**Trade engine** — Applies settings before submitting:
- Kill switch (blocks all new orders)
- Paper mode (simulates fills at last price, records to DB, skips exchange)
- Max position size, max open positions, max daily loss / drawdown cutoff
- Symbol allow-list

**SharkExchange client** — Server-only module: signed requests, place/cancel/status/balances, retries with backoff, error surfacing.

**Dashboard** (`/`)
- Big status: Live / Paper / Killed
- Toggle: kill switch, paper mode
- Cards: equity, today's P&L, open positions, win rate
- Tables: open orders, recent trades, webhook log
- Equity curve chart

**Settings** (`/settings`)
- Risk parameters
- Symbol allow-list
- Webhook URL + secret (with regenerate)
- SharkExchange API key status (stored as project secrets, not shown)

**Auth** — Single-user email/password via Lovable Cloud. First signup becomes the owner; further signups blocked.

## Data model (Lovable Cloud / Postgres)

- `settings` (singleton): kill_switch, paper_mode, max_position_usd, max_open_positions, max_daily_loss_usd, allowed_symbols[]
- `webhook_events`: id, received_at, raw_payload, alert_id (unique), status, reason
- `orders`: id, exchange_order_id, symbol, side, qty, price, status, paper, created_at
- `trades`: id, order_id, symbol, side, qty, entry, exit, pnl, closed_at
- `positions`: symbol, qty, avg_entry, unrealized_pnl, updated_at
- `activity_log`: severity, message, context, created_at

All tables RLS-locked to the owner user; service_role used by server functions.

## Secrets

- `TRADINGVIEW_WEBHOOK_SECRET` — auto-generated
- `SHARKEXCHANGE_API_KEY` — you paste (via secure form)
- `SHARKEXCHANGE_API_SECRET` — you paste
- `SHARKEXCHANGE_API_PASSPHRASE` — if required (depends on their auth)

## TradingView alert format

You'll paste this JSON into TradingView's alert message field:

```json
{
  "secret": "{{WEBHOOK_SECRET}}",
  "alert_id": "{{timenow}}-{{ticker}}",
  "symbol": "{{ticker}}",
  "action": "buy",
  "price": {{close}},
  "size_pct": 100
}
```

## Build order

1. Enable Lovable Cloud, auth, migrations for tables above (with GRANTs + RLS)
2. Settings singleton + dashboard shell with kill switch and paper toggle
3. Webhook route with secret verification, dedupe, activity log
4. `SharkExchangeClient` interface + paper-mode implementation (works end-to-end without real API)
5. Risk engine + order placement server functions
6. Trade/position tracking + P&L calculation
7. Dashboard tables, equity chart, settings page
8. Real SharkExchange client — filled in once you share docs
9. Test flow: send simulated webhook → verify paper trade appears → then live with tiny size

## Risks / notes

- **You are responsible for the strategy's real-money behavior.** I'll add safety rails (kill switch, caps, paper mode) but can't guarantee exchange fills or prevent losses.
- Cloudflare Workers runtime (where server functions run) has no persistent background loop — position monitoring runs on webhook triggers and dashboard polls, not a always-on process. If your strategy needs continuous polling (e.g. trailing stops managed server-side), we'll need to add a cron via Supabase `pg_cron` hitting a public endpoint.
- Without API docs, step 8 is a blocker for live trading. Steps 1–7 are fully buildable in paper mode meanwhile.
