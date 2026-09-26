from __future__ import annotations
from dataclasses import dataclass
from enum import Enum

class ExecutionMode(str, Enum):
    PAPER = "PAPER"
    LIVE = "LIVE"

@dataclass(frozen=True)
class RiskLimits:
    max_order_notional: float
    max_daily_loss: float
    max_open_positions: int

@dataclass(frozen=True)
class OrderIntent:
    symbol: str
    side: str
    quantity: float
    price: float | None
    mode: ExecutionMode

@dataclass(frozen=True)
class RiskDecision:
    approved: bool
    reason: str

class RiskGate:
    def __init__(self, limits: RiskLimits):
        self.limits = limits

    def evaluate(self, intent: OrderIntent, daily_pnl: float, open_positions: int, reference_price: float) -> RiskDecision:
        if intent.quantity <= 0:
            return RiskDecision(False, "quantity_must_be_positive")
        notional = intent.quantity * (intent.price or reference_price)
        if notional > self.limits.max_order_notional:
            return RiskDecision(False, "order_notional_limit")
        if daily_pnl <= -abs(self.limits.max_daily_loss):
            return RiskDecision(False, "daily_loss_limit")
        if open_positions >= self.limits.max_open_positions:
            return RiskDecision(False, "open_position_limit")
        if intent.mode == ExecutionMode.LIVE:
            return RiskDecision(False, "live_execution_requires_explicit_broker_adapter")
        return RiskDecision(True, "paper_execution_approved")
