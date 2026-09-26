from __future__ import annotations
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict

class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"

class Bar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = Field(ge=0)

class BacktestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = Field(min_length=1, max_length=32)
    strategy_id: str = Field(min_length=1, max_length=128)
    bars: list[Bar] = Field(default_factory=list, min_length=0)
    dataset_s3_uri: str | None = None
    initial_capital: float = Field(default=25_000, gt=0)
    risk_per_trade: float = Field(default=0.01, gt=0, lt=1)
    fee_bps: float = Field(default=4.0, ge=0)
    slippage_bps: float = Field(default=1.0, ge=0)

class Trade(BaseModel):
    entry_time: datetime
    exit_time: datetime
    side: Side
    entry_price: float
    exit_price: float
    quantity: float
    gross_pnl: float
    fees: float
    net_pnl: float
    return_pct: float

class BacktestMetrics(BaseModel):
    total_return_pct: float
    annualized_return_pct: float
    sharpe: float
    sortino: float
    profit_factor: float | None
    max_drawdown_pct: float
    win_rate_pct: float
    expectancy: float
    trade_count: int

class BacktestResult(BaseModel):
    run_id: str
    created_at: datetime
    symbol: str
    strategy_id: str
    metrics: BacktestMetrics
    equity_curve: list[float]
    trades: list[Trade]
    engine_version: str
    request_fingerprint: str
    dataset_fingerprint: str
