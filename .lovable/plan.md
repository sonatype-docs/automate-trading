# XAUUSDT Strategy Engine

Auto-run your 1H IST-anchored fib strategy from the server. No TradingView needed.

## Strategy rules (locked in)

- **Instrument**: XAUUSDT on SharkExchange, 1H timeframe
- **Reference candle**: the 1H IST candle at 05:30–06:30 (`00:00–01:00 UTC`), captured once per IST day
- **Zone**: `high` = fib 0, `low` = fib 1 → fib levels priced as `high - (high-low)*level`
  - `0.25` = high − 25% of range
  - `0.75` = high − 75% of range
- **Trigger**: a subsequent 1H candle must **close fully outside** the zone (close > high → bullish break, close < low → bearish break)
- **Entries** (pending, filled by later 1H close crossing the level):
  - **Long**: entry at `0.25`, SL at `0.75`  (buy the pullback after bullish break)
  - **Short**: entry at `0.75`, SL at `0.25` (sell the pullback after bearish break)
- **TP**: 1:3 R:R (configurable, default 3.0)
- **Sizing**: qty auto-computed so `|entry − SL| × qty ≈ $20` (configurable `sl_risk_usd`, default 20)
- **Lifecycle**: one long + one short setup per IST day max; setups expire at next 05:30 IST or when TP/SL hits; kill switch + existing risk caps still apply

## Architecture

```text
pg_cron (every 5 min)
      │
      ▼
POST /api/public/hooks/strategy-tick   (public, apikey header)
      │
      ▼
strategy engine (server)
  1. load/refresh today's IST zone from 1H candles
  2. detect break-close since last tick
  3. arm pending setups (long @0.25 / short @0.75)
  4. check price vs pending entries → trigger via processSignal()
  5. monitor open positions → close at TP/SL via processSignal({action:"close"})
      │
      ▼
existing orders / trades / positions tables
      │
      ▼
dashboard (new "Strategy" card)
```

Reuses your existing `processSignal` / order + position machinery — the engine just decides *when* to fire buy/sell/close signals.

## What gets built

### 1. DB (one migration)

- `strategy_settings` (singleton): `enabled bool`, `symbol text default 'XAUUSDT'`, `sl_risk_usd numeric default 20`, `rr numeric default 3`, `session_start_ist time default '05:30'`, `updated_at`
- `strategy_sessions`: `ist_date date pk`, `zone_high numeric`, `zone_low numeric`, `break_side text null` (`long`|`short`|null), `break_detected_at timestamptz`, `created_at`
- `strategy_setups`: `id uuid`, `ist_date date`, `side text` (`long`|`short`), `entry_price`, `sl_price`, `tp_price`, `qty`, `status text` (`armed`|`triggered`|`expired`|`cancelled`), `order_id uuid null`, `filled_at`, `closed_at`, `close_reason text` (`tp`|`sl`|`manual`|`session_end`), `pnl_usd numeric null`
- Full GRANTs + RLS (owner-read same as existing tables); writes via service role from the engine

### 2. Market data

Add to `shark-client.server.ts`:
- `getKlines(symbol, interval='1h', limit=48)` → hits SharkExchange public candles endpoint (same base as the ticker you already use); returns `[{openTime, open, high, low, close, closeTime}]`
- `getLastPrice(symbol)` — reuse the existing ticker fetch

### 3. Engine (`src/lib/strategy/engine.server.ts`)

Pure function `runStrategyTick()`:
1. Read `strategy_settings`; bail if `!enabled` or global `kill_switch`
2. Compute today's IST date; upsert `strategy_sessions` row using the 00:00–01:00 UTC 1H candle (`high`, `low`)
3. Since last tick, scan 1H **closed** candles; if `close > zone_high` set `break_side='long'`, if `close < zone_low` set `break_side='short'` (first break wins per day per side)
4. On new break, insert an `armed` setup with computed `entry/sl/tp/qty` (qty = `20 / |entry-sl|`)
5. For each `armed` setup, check current price:
   - long: if `low_of_current_1h <= entry` → trigger buy via `processSignal({action:'buy', price:entry, size_usd: qty*entry})`, mark `triggered`
   - short: mirror with sell
6. For each `triggered` setup with an open position: if price ≥ tp (long) or ≤ sl → close via `processSignal({action:'close', price: currentPrice})`, record `pnl_usd`, `close_reason`
7. Expire any leftover `armed` setups at next session start

### 4. Cron

`src/routes/api/public/hooks/strategy-tick.ts` — POST, validates `apikey` header against publishable key, calls `runStrategyTick()`, returns summary.

`pg_cron` job every 5 min hitting the stable `project--<id>.lovable.app` URL.

### 5. Server fns (in `trading.functions.ts`)

- `getStrategySettings` / `updateStrategySettings`
- `getStrategyState` → today's session (zone + break), armed/triggered setups, recent closed setups
- `runStrategyTickNow` → manual trigger button

### 6. UI

**Dashboard (`src/routes/index.tsx`)** — new "Strategy" card above the equity curve:
- Status pill: Disabled / Waiting for zone / Zone set (no break) / Broken long / Broken short / In trade
- Zone: high / 0.25 / 0.75 / low with current price marker
- Active setups table: side, entry, SL, TP, qty, status
- "Run tick now" button

**Settings (`src/routes/settings.tsx`)** — new section:
- Enable/disable toggle
- Symbol (default XAUUSDT)
- SL risk USD (default 20)
- R:R (default 3)
- Session start IST time (default 05:30)

## Technical notes

- IST = UTC+5:30, no DST — safe to compute IST date via `Date` + offset
- SharkExchange returns Binance-style klines; array items indexed `[openTime, open, high, low, close, volume, closeTime, ...]`
- Only act on **closed** candles for break detection (skip the currently-forming 1H bar)
- Setups reuse `processSignal`, so kill switch, symbol allow-list, max positions, daily-loss cap, and paper/live mode all apply automatically
- Cron polling every 5 min means worst-case 5 min slippage on entries; acceptable for a 1H strategy. Bump to every 1 min if you want tighter fills

## Open items before build

None blocking — I'll wire it up with these defaults and you can tweak in Settings. If SharkExchange's klines endpoint path differs from the standard `/v1/market/klines/{pair}?interval=1h`, I'll adjust after the first live call.
