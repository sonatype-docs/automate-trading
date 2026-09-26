from __future__ import annotations
from dataclasses import dataclass
from math import sqrt
from statistics import mean, pstdev
from .models import Bar
from .orderflow import OrderFlowFeatures
from .orderflow_strategy import Signal as OrderFlowSignal, evaluate as evaluate_orderflow

@dataclass(frozen=True)
class StrategySignal:
    strategy_id: str
    action: str
    reason: str

def _sma(values: list[float], n: int) -> float | None:
    return mean(values[-n:]) if len(values) >= n else None

def _ema(values: list[float], n: int) -> float | None:
    if len(values) < n:
        return None
    alpha = 2.0 / (n + 1)
    value = mean(values[:n])
    for price in values[n:]:
        value = alpha * price + (1 - alpha) * value
    return value

def _atr(bars: list[Bar], n: int = 14) -> float | None:
    if len(bars) < n + 1:
        return None
    trs = []
    for i in range(1, len(bars)):
        prev = bars[i - 1].close
        trs.append(max(bars[i].high - bars[i].low, abs(bars[i].high - prev), abs(bars[i].low - prev)))
    return mean(trs[-n:])

def _rsi(closes: list[float], n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(x, 0) for x in changes[-n:]]
    losses = [max(-x, 0) for x in changes[-n:]]
    avg_loss = mean(losses)
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + mean(gains) / avg_loss)

def _donchian(bars: list[Bar], n: int) -> tuple[float, float] | None:
    if len(bars) < n + 1:
        return None
    window = bars[-n-1:-1]
    return max(x.high for x in window), min(x.low for x in window)

def _bollinger(closes: list[float], n: int = 20, k: float = 2.0):
    if len(closes) < n + 1:
        return None
    window = closes[-n-1:-1]
    m = mean(window)
    sd = pstdev(window)
    return m, m + k * sd, m - k * sd

def london_orb(bars: list[Bar], range_bars: int = 20) -> StrategySignal:
    if len(bars) < range_bars + 1:
        return StrategySignal("STRAT-01-LONDON-ORB", "FLAT", "insufficient_bars")
    range_high = max(x.high for x in bars[-range_bars-1:-1])
    range_low = min(x.low for x in bars[-range_bars-1:-1])
    close = bars[-1].close
    if close > range_high:
        return StrategySignal("STRAT-01-LONDON-ORB", "LONG", "range_high_break")
    if close < range_low:
        return StrategySignal("STRAT-01-LONDON-ORB", "SHORT", "range_low_break")
    return StrategySignal("STRAT-01-LONDON-ORB", "FLAT", "inside_range")

def turtle_donchian(bars: list[Bar], entry: int = 20, exit: int = 10) -> StrategySignal:
    entry_channel = _donchian(bars, entry)
    exit_channel = _donchian(bars, exit)
    if not entry_channel or not exit_channel:
        return StrategySignal("STRAT-02-TURTLE-DONCHIAN", "FLAT", "insufficient_bars")
    close = bars[-1].close
    if close > entry_channel[0]:
        return StrategySignal("STRAT-02-TURTLE-DONCHIAN", "LONG", "donchian_high_break")
    if close < entry_channel[1]:
        return StrategySignal("STRAT-02-TURTLE-DONCHIAN", "SHORT", "donchian_low_break")
    if close < exit_channel[1]:
        return StrategySignal("STRAT-02-TURTLE-DONCHIAN", "EXIT_LONG", "exit_channel_break")
    if close > exit_channel[0]:
        return StrategySignal("STRAT-02-TURTLE-DONCHIAN", "EXIT_SHORT", "exit_channel_break")
    return StrategySignal("STRAT-02-TURTLE-DONCHIAN", "FLAT", "no_break")

def bollinger_squeeze(bars: list[Bar], n: int = 20, k: float = 2.0) -> StrategySignal:
    closes = [x.close for x in bars]
    bands = _bollinger(closes, n, k)
    atr = _atr(bars, n)
    if not bands or atr is None:
        return StrategySignal("STRAT-04-BOLLINGER-SQUEEZE", "FLAT", "insufficient_bars")
    mid, upper, lower = bands
    prev = closes[-2]
    squeeze_width = upper - lower
    if prev <= upper and closes[-1] > upper and squeeze_width > 2 * atr:
        return StrategySignal("STRAT-04-BOLLINGER-SQUEEZE", "LONG", "volatility_expansion_up")
    if prev >= lower and closes[-1] < lower and squeeze_width > 2 * atr:
        return StrategySignal("STRAT-04-BOLLINGER-SQUEEZE", "SHORT", "volatility_expansion_down")
    return StrategySignal("STRAT-04-BOLLINGER-SQUEEZE", "FLAT", "no_confirmed_expansion")

def vwap_reversion(bars: list[Bar], threshold: float = 2.0) -> StrategySignal:
    if len(bars) < 20:
        return StrategySignal("STRAT-05-VWAP-REVERSION", "FLAT", "insufficient_bars")
    recent = bars[-20:]
    volume = sum(x.volume for x in recent)
    if volume <= 0:
        return StrategySignal("STRAT-05-VWAP-REVERSION", "FLAT", "no_volume")
    vwap = sum(x.close * x.volume for x in recent) / volume
    deviations = [x.close - vwap for x in recent]
    sd = pstdev(deviations)
    if sd == 0:
        return StrategySignal("STRAT-05-VWAP-REVERSION", "FLAT", "zero_deviation")
    z = (bars[-1].close - vwap) / sd
    if z >= threshold:
        return StrategySignal("STRAT-05-VWAP-REVERSION", "SHORT", "upper_vwap_extension")
    if z <= -threshold:
        return StrategySignal("STRAT-05-VWAP-REVERSION", "LONG", "lower_vwap_extension")
    return StrategySignal("STRAT-05-VWAP-REVERSION", "FLAT", "inside_vwap_bands")

def order_flow_delta(features: OrderFlowFeatures) -> StrategySignal:
    signal = evaluate_orderflow(features)
    return StrategySignal(
        "STRAT-06-ORDER-FLOW-DELTA",
        signal.signal.value,
        signal.reason,
    )

def dual_momentum(bars: list[Bar], fast: int = 21, slow: int = 55) -> StrategySignal:
    closes = [x.close for x in bars]
    fast_ema = _ema(closes, fast)
    slow_ema = _ema(closes, slow)
    rsi = _rsi(closes)
    if fast_ema is None or slow_ema is None or rsi is None:
        return StrategySignal("STRAT-07-DUAL-MOMENTUM", "FLAT", "insufficient_bars")
    if fast_ema > slow_ema and rsi > 50:
        return StrategySignal("STRAT-07-DUAL-MOMENTUM", "LONG", "higher_timeframe_bull_alignment")
    if fast_ema < slow_ema and rsi < 50:
        return StrategySignal("STRAT-07-DUAL-MOMENTUM", "SHORT", "higher_timeframe_bear_alignment")
    return StrategySignal("STRAT-07-DUAL-MOMENTUM", "FLAT", "momentum_not_aligned")

def chandelier_trend(bars: list[Bar], n: int = 22, multiplier: float = 2.4) -> StrategySignal:
    atr = _atr(bars, 14)
    if len(bars) < n + 1 or atr is None:
        return StrategySignal("STRAT-08-CHANDELIER-TRAIL", "FLAT", "insufficient_bars")
    highest = max(x.high for x in bars[-n:])
    lowest = min(x.low for x in bars[-n:])
    long_stop = highest - multiplier * atr
    short_stop = lowest + multiplier * atr
    close = bars[-1].close
    if close > long_stop:
        return StrategySignal("STRAT-08-CHANDELIER-TRAIL", "LONG", "above_chandelier_long_stop")
    if close < short_stop:
        return StrategySignal("STRAT-08-CHANDELIER-TRAIL", "SHORT", "below_chandelier_short_stop")
    return StrategySignal("STRAT-08-CHANDELIER-TRAIL", "FLAT", "inside_chandelier")

def evaluate_strategy(strategy_id: str, bars: list[Bar], orderflow: OrderFlowFeatures | None = None) -> StrategySignal:
    if strategy_id == "STRAT-01-LONDON-ORB":
        return london_orb(bars)
    if strategy_id == "STRAT-02-TURTLE-DONCHIAN":
        return turtle_donchian(bars)
    if strategy_id == "STRAT-04-BOLLINGER-SQUEEZE":
        return bollinger_squeeze(bars)
    if strategy_id == "STRAT-05-VWAP-REVERSION":
        return vwap_reversion(bars)
    if strategy_id == "STRAT-06-ORDER-FLOW-DELTA":
        if orderflow is None:
            raise ValueError("STRAT-06 requires orderflow features")
        return order_flow_delta(orderflow)
    if strategy_id == "STRAT-07-DUAL-MOMENTUM":
        return dual_momentum(bars)
    if strategy_id == "STRAT-08-CHANDELIER-TRAIL":
        return chandelier_trend(bars)
    if strategy_id == "STRAT-03-STAT-COINT":
        return StrategySignal(strategy_id, "REQUIRES_PAIR_DATA", "pair_spread_engine_pending")
    raise ValueError(f"Unknown strategy_id: {strategy_id}")
