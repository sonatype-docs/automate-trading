from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable

class Aggressor(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    UNKNOWN = "UNKNOWN"

@dataclass(frozen=True)
class TradeTick:
    timestamp_ms: int
    price: float
    quantity: float
    aggressor: Aggressor

@dataclass(frozen=True)
class BookLevel:
    price: float
    quantity: float

@dataclass(frozen=True)
class BookDelta:
    timestamp_ms: int
    side: str
    price: float
    quantity: float

@dataclass(frozen=True)
class OrderBookSnapshot:
    timestamp_ms: int
    bids: tuple[BookLevel, ...]
    asks: tuple[BookLevel, ...]

@dataclass(frozen=True)
class OrderFlowFeatures:
    timestamp_ms: int
    best_bid: float | None
    best_ask: float | None
    mid_price: float | None
    spread: float | None
    bid_depth: float
    ask_depth: float
    imbalance: float
    buy_volume: float
    sell_volume: float
    delta: float
    cumulative_volume_delta: float
    price_change: float
    absorption_score: float

class OrderBook:
    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}

    def apply_snapshot(self, snapshot: OrderBookSnapshot) -> None:
        self.bids = {level.price: level.quantity for level in snapshot.bids if level.quantity > 0}
        self.asks = {level.price: level.quantity for level in snapshot.asks if level.quantity > 0}

    def apply_delta(self, delta: BookDelta) -> None:
        if delta.side.upper() not in {"BID", "ASK"}:
            raise ValueError("side must be BID or ASK")
        book = self.bids if delta.side.upper() == "BID" else self.asks
        if delta.quantity <= 0:
            book.pop(delta.price, None)
        else:
            book[delta.price] = delta.quantity

    def top(self) -> tuple[BookLevel | None, BookLevel | None]:
        bid = max(self.bids) if self.bids else None
        ask = min(self.asks) if self.asks else None
        return (
            BookLevel(bid, self.bids[bid]) if bid is not None else None,
            BookLevel(ask, self.asks[ask]) if ask is not None else None,
        )

    def depth(self, levels: int = 10) -> tuple[float, float]:
        if levels < 1:
            raise ValueError("levels must be >= 1")
        bid_depth = sum(qty for _, qty in sorted(self.bids.items(), reverse=True)[:levels])
        ask_depth = sum(qty for _, qty in sorted(self.asks.items())[:levels])
        return bid_depth, ask_depth

class OrderFlowCalculator:
    def __init__(self, depth_levels: int = 10) -> None:
        self.book = OrderBook()
        self.depth_levels = depth_levels
        self.cvd = 0.0
        self.previous_price: float | None = None
        self.buy_volume = 0.0
        self.sell_volume = 0.0

    def snapshot(self, value: OrderBookSnapshot) -> OrderFlowFeatures:
        self.book.apply_snapshot(value)
        return self.features(value.timestamp_ms)

    def delta(self, value: BookDelta) -> OrderFlowFeatures:
        self.book.apply_delta(value)
        return self.features(value.timestamp_ms)

    def trade(self, value: TradeTick) -> OrderFlowFeatures:
        if value.price <= 0 or value.quantity <= 0:
            raise ValueError("trade price and quantity must be positive")
        if value.aggressor == Aggressor.BUY:
            self.buy_volume += value.quantity
            self.cvd += value.quantity
        elif value.aggressor == Aggressor.SELL:
            self.sell_volume += value.quantity
            self.cvd -= value.quantity
        return self.features(value.timestamp_ms, trade_price=value.price)

    def features(self, timestamp_ms: int, trade_price: float | None = None) -> OrderFlowFeatures:
        bid, ask = self.book.top()
        bid_depth, ask_depth = self.book.depth(self.depth_levels)
        total_depth = bid_depth + ask_depth
        imbalance = 0.0 if total_depth == 0 else (bid_depth - ask_depth) / total_depth
        mid = None if bid is None or ask is None else (bid.price + ask.price) / 2
        spread = None if bid is None or ask is None else ask.price - bid.price
        mark = trade_price if trade_price is not None else mid
        price_change = 0.0 if mark is None or self.previous_price is None else mark - self.previous_price
        if mark is not None:
            self.previous_price = mark

        # Positive score: aggressive flow is buying while price fails to rise
        # against available depth; negative is the mirror image.
        delta = self.buy_volume - self.sell_volume
        absorption_score = 0.0
        if mark is not None and abs(delta) > 0:
            absorption_score = -delta * price_change

        return OrderFlowFeatures(
            timestamp_ms=timestamp_ms,
            best_bid=bid.price if bid else None,
            best_ask=ask.price if ask else None,
            mid_price=mid,
            spread=spread,
            bid_depth=bid_depth,
            ask_depth=ask_depth,
            imbalance=imbalance,
            buy_volume=self.buy_volume,
            sell_volume=self.sell_volume,
            delta=delta,
            cumulative_volume_delta=self.cvd,
            price_change=price_change,
            absorption_score=absorption_score,
        )

def classify_trade(
    price: float,
    best_bid: float | None,
    best_ask: float | None,
    previous_trade_price: float | None = None,
) -> Aggressor:
    if best_ask is not None and price >= best_ask:
        return Aggressor.BUY
    if best_bid is not None and price <= best_bid:
        return Aggressor.SELL
    if previous_trade_price is not None:
        if price > previous_trade_price:
            return Aggressor.BUY
        if price < previous_trade_price:
            return Aggressor.SELL
    return Aggressor.UNKNOWN

def replay(
    snapshots: Iterable[OrderBookSnapshot],
    trades: Iterable[TradeTick] = (),
    deltas: Iterable[BookDelta] = (),
) -> list[OrderFlowFeatures]:
    events = []
    for item in snapshots:
        events.append((item.timestamp_ms, 0, item))
    for item in deltas:
        events.append((item.timestamp_ms, 1, item))
    for item in trades:
        events.append((item.timestamp_ms, 2, item))
    events.sort(key=lambda x: (x[0], x[1]))

    calculator = OrderFlowCalculator()
    output = []
    for _, _, item in events:
        if isinstance(item, OrderBookSnapshot):
            output.append(calculator.snapshot(item))
        elif isinstance(item, BookDelta):
            output.append(calculator.delta(item))
        else:
            output.append(calculator.trade(item))
    return output
