from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
import math
import numpy as np
from .models import BacktestRequest, BacktestResult, BacktestMetrics, Side, Trade
from .provenance import ENGINE_VERSION, request_fingerprint, dataset_fingerprint

def _safe_sharpe(returns):
    if len(returns) < 2 or float(np.std(returns, ddof=1)) == 0:
        return 0.0
    return float(np.mean(returns) / np.std(returns, ddof=1) * math.sqrt(252))

def _safe_sortino(returns):
    downside = returns[returns < 0]
    if len(downside) == 0:
        return 0.0 if len(returns) == 0 else float(np.mean(returns) * math.sqrt(252))
    deviation = float(np.sqrt(np.mean(np.square(downside))))
    return 0.0 if deviation == 0 else float(np.mean(returns) / deviation * math.sqrt(252))

def _max_drawdown(equity):
    if len(equity) == 0:
        return 0.0
    peaks = np.maximum.accumulate(equity)
    return float(abs(np.min(equity / peaks - 1.0)) * 100.0)

def run_backtest(request: BacktestRequest) -> BacktestResult:
    bars = request.bars
    capital = float(request.initial_capital)
    equity = [capital]
    trades = []
    position = None

    for i in range(20, len(bars)):
        bar = bars[i]
        prior20 = max(x.high for x in bars[i - 20:i])
        prior10 = min(x.low for x in bars[i - 10:i])

        if position is None and bar.close > prior20:
            risk_cash = capital * request.risk_per_trade
            stop_distance = max(bar.close - prior10, bar.close * 0.005)
            quantity = risk_cash / stop_distance
            entry = bar.close * (1.0 + request.slippage_bps / 10000.0)
            entry_fee = entry * quantity * request.fee_bps / 10000.0
            position = {"time": bar.timestamp, "entry": entry, "qty": quantity, "entry_fee": entry_fee}
        elif position is not None and bar.close < prior10:
            exit_price = bar.close * (1.0 - request.slippage_bps / 10000.0)
            gross = (exit_price - position["entry"]) * position["qty"]
            exit_fee = exit_price * position["qty"] * request.fee_bps / 10000.0
            fees = position["entry_fee"] + exit_fee
            net = gross - fees
            capital += net
            trades.append(Trade(entry_time=position["time"], exit_time=bar.timestamp, side=Side.BUY,
                entry_price=position["entry"], exit_price=exit_price, quantity=position["qty"],
                gross_pnl=gross, fees=fees, net_pnl=net,
                return_pct=net / (position["entry"] * position["qty"]) * 100.0))
            position = None

        mark = capital
        if position is not None:
            mark += (bar.close - position["entry"]) * position["qty"] - position["entry_fee"]
        equity.append(mark)

    if position is not None:
        bar = bars[-1]
        exit_price = bar.close * (1.0 - request.slippage_bps / 10000.0)
        gross = (exit_price - position["entry"]) * position["qty"]
        exit_fee = exit_price * position["qty"] * request.fee_bps / 10000.0
        fees = position["entry_fee"] + exit_fee
        net = gross - fees
        capital += net
        trades.append(Trade(entry_time=position["time"], exit_time=bar.timestamp, side=Side.BUY,
            entry_price=position["entry"], exit_price=exit_price, quantity=position["qty"],
            gross_pnl=gross, fees=fees, net_pnl=net,
            return_pct=net / (position["entry"] * position["qty"]) * 100.0))
        equity[-1] = capital

    curve = np.asarray(equity, dtype=float)
    returns = np.diff(curve) / np.maximum(curve[:-1], 1e-12)
    wins = [t.net_pnl for t in trades if t.net_pnl > 0]
    losses = [t.net_pnl for t in trades if t.net_pnl < 0]
    profit_factor = float(sum(wins) / abs(sum(losses))) if losses else (None if wins else 0.0)
    win_rate = float(len(wins) / len(trades) * 100.0) if trades else 0.0
    expectancy = float(np.mean([t.net_pnl for t in trades])) if trades else 0.0
    years = max((bars[-1].timestamp - bars[0].timestamp).total_seconds() / (365.25 * 86400), 1 / 365.25)
    total_return = capital / request.initial_capital - 1.0
    annualized = (1.0 + total_return) ** (1.0 / years) - 1.0 if capital > 0 else -1.0

    return BacktestResult(run_id=f"bt_{uuid4().hex}", created_at=datetime.now(timezone.utc),
        symbol=request.symbol, strategy_id=request.strategy_id,
        metrics=BacktestMetrics(total_return_pct=total_return * 100.0,
            annualized_return_pct=annualized * 100.0, sharpe=_safe_sharpe(returns),
            sortino=_safe_sortino(returns), profit_factor=profit_factor,
            max_drawdown_pct=_max_drawdown(curve), win_rate_pct=win_rate,
            expectancy=expectancy, trade_count=len(trades)),
        equity_curve=[float(x) for x in curve], trades=trades,
        engine_version=ENGINE_VERSION, request_fingerprint=request_fingerprint(request),
        dataset_fingerprint=dataset_fingerprint(request))
