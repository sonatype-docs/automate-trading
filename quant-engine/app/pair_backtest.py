from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
import math
import numpy as np
from .models import Bar
from .pair_strategy import cointegration_signal
from .provenance import ENGINE_VERSION

def run_pair_backtest(
    x_symbol: str,
    y_symbol: str,
    x_bars: list[Bar],
    y_bars: list[Bar],
    initial_capital: float = 25_000,
    risk_per_trade: float = 0.01,
    fee_bps: float = 4.0,
    slippage_bps: float = 1.0,
    window: int = 60,
    entry_z: float = 2.0,
    exit_z: float = 0.5,
) -> dict:
    if len(x_bars) != len(y_bars) or len(x_bars) < max(30, window + 2):
        raise ValueError("pair series must be aligned and contain enough bars")
    if any(a.timestamp != b.timestamp for a, b in zip(x_bars, y_bars)):
        raise ValueError("pair bars must have identical timestamps")
    if initial_capital <= 0 or not 0 < risk_per_trade < 1:
        raise ValueError("invalid capital or risk_per_trade")
    capital = float(initial_capital)
    equity = [capital]
    trades = []
    position = None

    for i in range(window, len(x_bars) - 1):
        signal = cointegration_signal(x_bars[: i + 1], y_bars[: i + 1], window, entry_z, exit_z)
        x = x_bars[i + 1]
        y = y_bars[i + 1]
        beta = signal.hedge_ratio
        if position is None and signal.action in {"LONG_SPREAD", "SHORT_SPREAD"} and beta > 0:
            x_notional = capital * risk_per_trade
            x_qty = x_notional / max(x.open, 1e-12)
            y_qty = beta * x_notional / max(y.open, 1e-12)
            direction = 1 if signal.action == "LONG_SPREAD" else -1
            entry_x = x.open * (1 + direction * slippage_bps / 10000)
            entry_y = y.open * (1 - direction * slippage_bps / 10000)
            fees = (abs(entry_x * x_qty) + abs(entry_y * y_qty)) * fee_bps / 10000
            position = {
                "time": x.timestamp,
                "x": entry_x,
                "y": entry_y,
                "x_qty": x_qty,
                "y_qty": y_qty,
                "direction": direction,
                "entry_fees": fees,
                "beta": beta,
                "entry_z": signal.z_score,
            }

        if position is not None and (signal.action == "EXIT_SPREAD" or
            (position["direction"] == 1 and signal.z_score >= entry_z) or
            (position["direction"] == -1 and signal.z_score <= -entry_z)):
            d_x = (x.open - position["x"]) * position["x_qty"]
            d_y = (position["y"] - y.open) * position["y_qty"]
            gross = position["direction"] * (d_x + d_y)
            exit_fees = (abs(x.open * position["x_qty"]) + abs(y.open * position["y_qty"])) * fee_bps / 10000
            net = gross - position["entry_fees"] - exit_fees
            capital += net
            trades.append({
                "entry_time": position["time"].isoformat(),
                "exit_time": x.timestamp.isoformat(),
                "direction": "LONG_SPREAD" if position["direction"] == 1 else "SHORT_SPREAD",
                "hedge_ratio": position["beta"],
                "entry_z": position["entry_z"],
                "exit_z": signal.z_score,
                "net_pnl": net,
            })
            position = None
        equity.append(capital)

    curve = np.asarray(equity, dtype=float)
    returns = np.diff(curve) / np.maximum(curve[:-1], 1e-12)
    wins = [t["net_pnl"] for t in trades if t["net_pnl"] > 0]
    losses = [t["net_pnl"] for t in trades if t["net_pnl"] < 0]
    pf = sum(wins) / abs(sum(losses)) if losses else (None if wins else 0.0)
    total_return = capital / initial_capital - 1
    years = max((x_bars[-1].timestamp - x_bars[0].timestamp).total_seconds() / (365.25 * 86400), 1 / 365.25)
    annualized = (1 + total_return) ** (1 / years) - 1 if capital > 0 else -1
    sd = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
    sharpe = float(np.mean(returns) / sd * math.sqrt(252)) if sd else 0.0
    peaks = np.maximum.accumulate(curve)
    max_dd = float(abs(np.min(curve / peaks - 1)) * 100) if len(curve) else 0.0
    return {
        "run_id": f"pair_{uuid4().hex}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "x_symbol": x_symbol,
        "y_symbol": y_symbol,
        "engine_version": ENGINE_VERSION,
        "parameters": {
            "initial_capital": initial_capital,
            "risk_per_trade": risk_per_trade,
            "fee_bps": fee_bps,
            "slippage_bps": slippage_bps,
            "window": window,
            "entry_z": entry_z,
            "exit_z": exit_z,
        },
        "metrics": {
            "total_return_pct": total_return * 100,
            "annualized_return_pct": annualized * 100,
            "sharpe": sharpe,
            "max_drawdown_pct": max_dd,
            "profit_factor": pf,
            "win_rate_pct": len(wins) / len(trades) * 100 if trades else 0.0,
            "trade_count": len(trades),
        },
        "trades": trades[-100:],
    }
