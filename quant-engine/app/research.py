from __future__ import annotations
from dataclasses import dataclass
from itertools import product
from .models import BacktestRequest, BacktestResult
from .strategy_backtest import run_strategy_backtest

SUPPORTED_SWEEP_FIELDS = {"initial_capital", "risk_per_trade", "fee_bps", "slippage_bps"}

@dataclass(frozen=True)
class SweepResult:
    parameters: dict[str, float]
    result: BacktestResult

@dataclass(frozen=True)
class WalkForwardWindow:
    train_start: int
    train_end: int
    test_start: int
    test_end: int
    result: BacktestResult

def _validate_strategy(request: BacktestRequest) -> None:
    if request.strategy_id == "STRAT-03-STAT-COINT":
        raise ValueError("STRAT-03 requires pair data and cannot run through the single-series research API")
    if request.strategy_id == "STRAT-06-ORDER-FLOW-DELTA":
        raise ValueError("STRAT-06 requires trade/order-book event data and cannot run through the bar-only research API")

def parameter_sweep(request: BacktestRequest, parameter_grid: dict[str, list[float]]) -> list[SweepResult]:
    _validate_strategy(request)
    unknown = set(parameter_grid) - SUPPORTED_SWEEP_FIELDS
    if unknown:
        raise ValueError("unsupported sweep fields: " + ", ".join(sorted(unknown)))
    if not parameter_grid:
        return [SweepResult({}, run_strategy_backtest(request))]
    keys = sorted(parameter_grid)
    values = [parameter_grid[key] for key in keys]
    output: list[SweepResult] = []
    for combo in product(*values):
        params = dict(zip(keys, combo))
        candidate = request.model_copy(update=params)
        output.append(SweepResult(params, run_strategy_backtest(candidate)))
    return output

def walk_forward(
    request: BacktestRequest,
    train_bars: int,
    test_bars: int,
    step_bars: int | None = None,
) -> list[WalkForwardWindow]:
    _validate_strategy(request)
    if train_bars < 30 or test_bars < 30:
        raise ValueError("train_bars and test_bars must both be >= 30 for the current strategy lookback")
    step = step_bars or test_bars
    if step < 1:
        raise ValueError("step_bars must be >= 1")
    windows: list[WalkForwardWindow] = []
    start = 0
    while start + train_bars + test_bars <= len(request.bars):
        test_start = start + train_bars
        test_end = test_start + test_bars
        test_request = request.model_copy(update={"bars": request.bars[test_start:test_end]})
        result = run_strategy_backtest(test_request)
        windows.append(WalkForwardWindow(start, test_start, test_start, test_end, result))
        start += step
    return windows
