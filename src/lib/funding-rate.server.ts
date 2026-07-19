// Perp funding-rate fetcher (Binance public premiumIndex).
// Cached in-memory for 60s. Used by funding-fade strategies to gate entries
// around funding settlement (typically every 8h at 00/08/16 UTC).

interface FundingSnapshot {
  symbol: string;
  fundingRate: number;        // e.g. 0.0004 = 4 bps
  markPrice: number;
  nextFundingTimeMs: number;  // ms epoch of next settlement
  fetchedAtMs: number;
}

const cache = new Map<string, FundingSnapshot>();
const TTL_MS = 60_000;

function toBinanceSymbol(sym: string): string {
  // Our internal symbols match Binance perp naming (BTCUSDT, ETHUSDT).
  // XAU is not on Binance perp — fail closed.
  if (sym === "XAUUSDT") throw new Error("Funding rate not available for XAUUSDT");
  return sym;
}

export async function getFundingSnapshot(symbol: string): Promise<FundingSnapshot> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAtMs < TTL_MS) return cached;

  const bSym = toBinanceSymbol(symbol);
  const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${bSym}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Binance premiumIndex ${res.status}`);
  const j = (await res.json()) as {
    symbol: string;
    markPrice: string;
    lastFundingRate: string;
    nextFundingTime: number;
  };
  const snap: FundingSnapshot = {
    symbol,
    fundingRate: Number(j.lastFundingRate),
    markPrice: Number(j.markPrice),
    nextFundingTimeMs: Number(j.nextFundingTime),
    fetchedAtMs: Date.now(),
  };
  cache.set(symbol, snap);
  return snap;
}

export interface FundingFadeGate {
  eligible: boolean;
  requiredDirection: "long" | "short" | null;
  fundingRate: number;
  minutesToFunding: number;
  reason: string;
}

/**
 * Funding-fade eligibility check.
 * Triggers only when |funding| exceeds threshold AND we're in the pre-funding
 * window. Direction is FADE — we take the opposite side of the crowd paying
 * funding (positive funding → shorts get paid → take SHORT).
 */
export async function checkFundingFadeGate(
  symbol: string,
  opts: { minAbsRate?: number; windowMinBefore?: number; windowMinCutoff?: number } = {},
): Promise<FundingFadeGate> {
  const minAbs = opts.minAbsRate ?? 0.0003;        // 3 bps
  const windowStart = opts.windowMinBefore ?? 45;  // start looking 45m before
  const windowEnd = opts.windowMinCutoff ?? 2;     // stop 2m before settlement
  try {
    const snap = await getFundingSnapshot(symbol);
    const minutes = (snap.nextFundingTimeMs - Date.now()) / 60_000;
    if (minutes > windowStart) {
      return { eligible: false, requiredDirection: null, fundingRate: snap.fundingRate, minutesToFunding: minutes, reason: `too early (${minutes.toFixed(0)}m out)` };
    }
    if (minutes < windowEnd) {
      return { eligible: false, requiredDirection: null, fundingRate: snap.fundingRate, minutesToFunding: minutes, reason: `too late (${minutes.toFixed(0)}m out)` };
    }
    if (Math.abs(snap.fundingRate) < minAbs) {
      return { eligible: false, requiredDirection: null, fundingRate: snap.fundingRate, minutesToFunding: minutes, reason: `rate ${(snap.fundingRate * 100).toFixed(3)}% below ${(minAbs * 100).toFixed(3)}%` };
    }
    const dir: "long" | "short" = snap.fundingRate > 0 ? "short" : "long";
    return { eligible: true, requiredDirection: dir, fundingRate: snap.fundingRate, minutesToFunding: minutes, reason: `fade ${dir} (funding ${(snap.fundingRate * 100).toFixed(3)}%)` };
  } catch (e) {
    return { eligible: false, requiredDirection: null, fundingRate: 0, minutesToFunding: -1, reason: e instanceof Error ? e.message : String(e) };
  }
}
