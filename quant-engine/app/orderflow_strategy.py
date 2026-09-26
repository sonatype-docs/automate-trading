from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from .orderflow import OrderFlowFeatures

class Signal(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    FLAT = "FLAT"

@dataclass(frozen=True)
class OrderFlowSignal:
    signal: Signal
    reason: str
    confidence: float

def evaluate(features: OrderFlowFeatures, imbalance_threshold: float = 0.20) -> OrderFlowSignal:
    if not -1.0 < imbalance_threshold < 1.0:
        raise ValueError("imbalance_threshold must be between -1 and 1")

    # Divergence/absorption guard: aggressive buying with flat/down price
    # is a short candidate; aggressive selling with flat/up price is long.
    if features.delta > 0 and features.price_change <= 0 and features.imbalance < -imbalance_threshold:
        confidence = min(1.0, 0.5 + abs(features.imbalance) * 0.5)
        return OrderFlowSignal(Signal.SHORT, "buy_delta_absorbed_by_offer_depth", confidence)

    if features.delta < 0 and features.price_change >= 0 and features.imbalance > imbalance_threshold:
        confidence = min(1.0, 0.5 + abs(features.imbalance) * 0.5)
        return OrderFlowSignal(Signal.LONG, "sell_delta_absorbed_by_bid_depth", confidence)

    return OrderFlowSignal(Signal.FLAT, "no_confirmed_order_flow_divergence", 0.0)
