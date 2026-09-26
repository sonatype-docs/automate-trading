from __future__ import annotations
from pydantic import BaseModel, Field
from .orderflow import Aggressor, BookDelta, BookLevel, OrderBookSnapshot, TradeTick, replay, OrderFlowFeatures
from .orderflow_strategy import evaluate

class TradeIn(BaseModel):
    timestamp_ms: int
    price: float = Field(gt=0)
    quantity: float = Field(gt=0)
    aggressor: Aggressor = Aggressor.UNKNOWN

class LevelIn(BaseModel):
    price: float = Field(gt=0)
    quantity: float = Field(ge=0)

class SnapshotIn(BaseModel):
    timestamp_ms: int
    bids: list[LevelIn] = Field(default_factory=list)
    asks: list[LevelIn] = Field(default_factory=list)

class DeltaIn(BaseModel):
    timestamp_ms: int
    side: str
    price: float = Field(gt=0)
    quantity: float = Field(ge=0)

class ReplayRequest(BaseModel):
    snapshots: list[SnapshotIn] = Field(default_factory=list)
    trades: list[TradeIn] = Field(default_factory=list)
    deltas: list[DeltaIn] = Field(default_factory=list)
    imbalance_threshold: float = Field(default=0.20, gt=-1, lt=1)

def run_replay(request: ReplayRequest) -> dict:
    events = replay(
        [OrderBookSnapshot(x.timestamp_ms, tuple(BookLevel(v.price, v.quantity) for v in x.bids), tuple(BookLevel(v.price, v.quantity) for v in x.asks)) for x in request.snapshots],
        [TradeTick(x.timestamp_ms, x.price, x.quantity, x.aggressor) for x in request.trades],
        [BookDelta(x.timestamp_ms, x.side, x.price, x.quantity) for x in request.deltas],
    )
    rows = []
    for f in events:
        signal = evaluate(f, request.imbalance_threshold)
        rows.append({
            "timestamp_ms": f.timestamp_ms,
            "best_bid": f.best_bid,
            "best_ask": f.best_ask,
            "mid_price": f.mid_price,
            "spread": f.spread,
            "bid_depth": f.bid_depth,
            "ask_depth": f.ask_depth,
            "imbalance": f.imbalance,
            "buy_volume": f.buy_volume,
            "sell_volume": f.sell_volume,
            "delta": f.delta,
            "cumulative_volume_delta": f.cumulative_volume_delta,
            "price_change": f.price_change,
            "absorption_score": f.absorption_score,
            "signal": signal.signal.value,
            "reason": signal.reason,
            "confidence": signal.confidence,
        })
    return {"event_count": len(rows), "rows": rows[-200:], "last": rows[-1] if rows else None}
