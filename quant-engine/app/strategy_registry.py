from __future__ import annotations
from dataclasses import dataclass
from typing import Callable
from .models import BacktestRequest, BacktestResult
from .engine import run_backtest
from .strategy_rules import evaluate_strategy

@dataclass(frozen=True)
class StrategyDefinition:
    strategy_id: str
    name: str
    description: str

STRATEGIES: tuple[StrategyDefinition, ...] = (
    StrategyDefinition("STRAT-01-LONDON-ORB", "London ORB", "London session range breakout."),
    StrategyDefinition("STRAT-02-TURTLE-DONCHIAN", "Turtle S1", "Donchian trend breakout."),
    StrategyDefinition("STRAT-03-STAT-COINT", "Stat-Arb Cointegration", "Pair-spread mean reversion."),
    StrategyDefinition("STRAT-04-BOLLINGER-SQUEEZE", "BB Squeeze", "Volatility compression/expansion."),
    StrategyDefinition("STRAT-05-VWAP-REVERSION", "VWAP Reversion", "Volume-weighted mean reversion."),
    StrategyDefinition("STRAT-06-ORDER-FLOW-DELTA", "Order Flow Delta", "L2 imbalance/CVD divergence."),
    StrategyDefinition("STRAT-07-DUAL-MOMENTUM", "Dual Momentum", "Multi-timeframe momentum alignment."),
    StrategyDefinition("STRAT-08-CHANDELIER-TRAIL", "Chandelier Trend", "ATR chandelier trend following."),
)
_REGISTRY = {item.strategy_id: item for item in STRATEGIES}

def get_strategy(strategy_id: str) -> StrategyDefinition:
    try:
        return _REGISTRY[strategy_id]
    except KeyError as exc:
        raise ValueError(f"Unknown strategy_id: {strategy_id}") from exc

def list_strategies() -> list[StrategyDefinition]:
    return list(STRATEGIES)

def signal_strategy(strategy_id: str, request: BacktestRequest, orderflow=None):
    get_strategy(strategy_id)
    return evaluate_strategy(strategy_id, request.bars, orderflow)
