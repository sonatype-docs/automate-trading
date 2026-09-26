from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
import math
import numpy as np
from .models import BacktestRequest, BacktestResult, BacktestMetrics, Side, Trade
from .strategy_rules import evaluate_strategy
from .provenance import ENGINE_VERSION, request_fingerprint, dataset_fingerprint

def run_strategy_backtest(request: BacktestRequest) -> BacktestResult:
    if request.strategy_id == "STRAT-03-STAT-COINT":
        raise ValueError("STRAT-03 requires pair data and cannot run on a single-symbol BacktestRequest")
    if request.strategy_id == "STRAT-06-ORDER-FLOW-DELTA":
        raise ValueError("STRAT-06 requires L2/trade events; use the order-flow replay pipeline")

    capital = float(request.initial_capital)
    equity = [capital]
    trades: list[Trade] = []
    position = None

    for i in range(1, len(request.bars)):
        history = request.bars[:i + 1]
        signal = evaluate_strategy(request.strategy_id, history)
        bar = request.bars[i]

        if position is None and signal.action in {"LONG", "SHORT"}:
            atr = _atr(history)
            stop_distance = max(atr * 2.0 if atr else bar.close * 0.005, bar.close * 0.002)
            risk_cash = capital * request.risk_per_trade
            quantity = risk_cash / stop_distance
            side = Side.BUY if signal.action == "LONG" else Side.SELL
            entry = bar.close * (1 + request.slippage_bps / 10000 if side == Side.BUY else 1 - request.slippage_bps / 10000)
            entry_fee = entry * quantity * request.fee_bps / 10000
            position = {"time": bar.timestamp, "entry": entry, "qty": quantity, "side": side, "stop": stop_distance, "entry_fee": entry_fee}

        if position is not None:
            side = position["side"]
            adverse = (
                bar.low <= position["entry"] - position["stop"] if side == Side.BUY
                else bar.high >= position["entry"] + position["stop"]
            )
            explicit_exit = signal.action in {"EXIT_LONG", "EXIT_SHORT"} and (
                (side == Side.BUY and signal.action == "EXIT_LONG") or
                (side == Side.SELL and signal.action == "EXIT_SHORT")
            )
            if adverse or explicit_exit:
                exit_price = (position["entry"] - position["stop"]) if side == Side.BUY else (position["entry"] + position["stop"])
                if explicit_exit and not adverse:
                    exit_price = bar.close * (1 - request.slippage_bps / 10000 if side == Side.BUY else 1 + request.slippage_bps / 10000)
                gross = ((exit_price - position["entry"]) if side == Side.BUY else (position["entry"] - exit_price)) * position["qty"]
                exit_fee = exit_price * position["qty"] * request.fee_bps / 10000
                fees = position["entry_fee"] + exit_fee
                net = gross - fees
                capital += net
                trades.append(Trade(
                    entry_time=position["time"], exit_time=bar.timestamp, side=side,
                    entry_price=position["entry"], exit_price=exit_price, quantity=position["qty"],
                    gross_pnl=gross, fees=fees, net_pnl=net,
                    return_pct=net / (position["entry"] * position["qty"]) * 100,
                ))
                position = None

        mark = capital
        if position is not None:
            pnl = ((bar.close - position["entry"]) if position["side"] == Side.BUY else (position["entry"] - bar.close)) * position["qty"]
            mark += pnl - position["entry_fee"]
        equity.append(mark)

    if position is not None:
        bar = request.bars[-1]
        exit_price = bar.close * (1 - request.slippage_bps / 10000 if position["side"] == Side.BUY else 1 + request.slippage_bps / 10000)
        gross = ((exit_price - position["entry"]) if position["side"] == Side.BUY else (position["entry"] - exit_price)) * position["qty"]
        exit_fee = exit_price * position["qty"] * request.fee_bps / 10000
        fees = position["entry_fee"] + exit_fee
        net = gross - fees
        capital += net
        trades.append(Trade(entry_time=position["time"], exit_time=bar.timestamp, side=position["side"],
            entry_price=position["entry"], exit_price=exit_price, quantity=position["qty"],
            gross_pnl=gross, fees=fees, net_pnl=net, return_pct=net / (position["entry"] * position["qty"]) * 100))
        equity[-1] = capital

    curve = np.asarray(equity, dtype=float)
    returns = np.diff(curve) / np.maximum(curve[:-1], 1e-12)
    wins = [t.net_pnl for t in trades if t.net_pnl > 0]
    losses = [t.net_pnl for t in trades if t.net_pnl < 0]
    profit_factor = sum(wins) / abs(sum(losses)) if losses else (None if wins else 0.0)
    win_rate = len(wins) / len(trades) * 100 if trades else 0.0
    expectancy = float(np.mean([t.net_pnl for t in trades])) if trades else 0.0
    years = max((request.bars[-1].timestamp - request.bars[0].timestamp).total_seconds() / (365.25 * 86400), 1 / 365.25)
    total_return = capital / request.initial_capital - 1
    annualized = (1 + total_return) ** (1 / years) - 1 if capital > 0 else -1

    return BacktestResult(
        run_id=f"bt_{uuid4().hex}", created_at=datetime.now(timezone.utc),
        symbol=request.symbol, strategy_id=request.strategy_id,
        metrics=BacktestMetrics(
            total_return_pct=total_return * 100, annualized_return_pct=annualized * 100,
            sharpe=_sharpe(returns), sortino=_sortino(returns),
            profit_factor=profit_factor, max_drawdown_pct=_drawdown(curve),
            win_rate_pct=win_rate, expectancy=expectancy, trade_count=len(trades)),
        equity_curve=[float(x) for x in curve], trades=trades,
        engine_version=ENGINE_VERSION, request_fingerprint=request_fingerprint(request),
        dataset_fingerprint=dataset_fingerprint(request),
    )

def _atr(bars, n=14):
    if len(bars) < n + 1:
        return None
    values = []
    for i in range(1, len(bars)):
        prev = bars[i-1].close
        values.append(max(bars[i].high-bars[i].low, abs(bars[i].high-prev), abs(bars[i].low-prev)))
    return float(np.mean(values[-n:]))

def _sharpe(values):
    if len(values) < 2 or float(np.std(values, ddof=1)) == 0:
        return 0.0
    return float(np.mean(values) / np.std(values, ddof=1) * math.sqrt(252))

def _sortino(values):
    if len(values) == 0:
        return 0.0
    downside = values[values < 0]
    if len(downside) == 0:
        return float(np.mean(values) * math.sqrt(252))
    deviation = float(np.sqrt(np.mean(np.square(downside))))
    return 0.0 if deviation == 0 else float(np.mean(values) / deviation * math.sqrt(252))

def _drawdown(equity):
    peaks = np.maximum.accumulate(equity)
    return float(abs(np.min(equity / peaks - 1)) * 100) if len(equity) else 0.0
