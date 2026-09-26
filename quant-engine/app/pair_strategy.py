from __future__ import annotations
from dataclasses import dataclass
from statistics import mean, pstdev
import math
from .models import Bar

@dataclass(frozen=True)
class PairSignal:
    action: str
    hedge_ratio: float
    z_score: float
    reason: str

def hedge_ratio(x: list[float], y: list[float]) -> float:
    if len(x) != len(y) or len(x) < 3:
        raise ValueError("paired series must have equal length >= 3")
    x_mean, y_mean = mean(x), mean(y)
    covariance = sum((a-x_mean)*(b-y_mean) for a,b in zip(x,y))
    variance = sum((b-y_mean)**2 for b in y)
    if variance == 0:
        raise ValueError("hedge series has zero variance")
    return covariance / variance

def spread_zscore(x: list[float], y: list[float], window: int = 30) -> tuple[float, float]:
    if len(x) != len(y) or len(x) < window:
        raise ValueError("paired series shorter than requested window")
    beta = hedge_ratio(x[-window:], y[-window:])
    spread = [a - beta*b for a,b in zip(x[-window:], y[-window:])]
    sd = pstdev(spread)
    if sd == 0:
        return beta, 0.0
    return beta, (spread[-1] - mean(spread)) / sd

def cointegration_signal(
    x_bars: list[Bar],
    y_bars: list[Bar],
    window: int = 30,
    entry_z: float = 2.0,
    exit_z: float = 0.5,
) -> PairSignal:
    if len(x_bars) != len(y_bars):
        raise ValueError("pair bars must be aligned and equal length")
    if window < 3 or entry_z <= 0 or exit_z < 0 or exit_z >= entry_z:
        raise ValueError("window must be >= 3 and require 0 <= exit_z < entry_z")
    x = [b.close for b in x_bars]
    y = [b.close for b in y_bars]
    beta, z = spread_zscore(x, y, window)
    if z >= entry_z:
        return PairSignal("SHORT_SPREAD", beta, z, "spread_above_upper_band")
    if z <= -entry_z:
        return PairSignal("LONG_SPREAD", beta, z, "spread_below_lower_band")
    if abs(z) <= exit_z:
        return PairSignal("EXIT_SPREAD", beta, z, "spread_reverted_to_mean")
    return PairSignal("FLAT", beta, z, "spread_inside_entry_band")
