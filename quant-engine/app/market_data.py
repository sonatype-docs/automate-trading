from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

@dataclass(frozen=True)
class MarketDataCapabilities:
    trades: bool
    order_book_snapshots: bool
    order_book_deltas: bool
    historical_replay: bool

class MarketDataProvider(Protocol):
    name: str
    capabilities: MarketDataCapabilities

    async def stream(self, symbol: str): ...

class ReplayMarketDataProvider:
    """Deterministic provider used by research/backtests.

    Live exchange connectors implement the same protocol without changing the
    order-flow calculation or strategy layers.
    """
    name = "replay"
    capabilities = MarketDataCapabilities(True, True, True, True)

    def __init__(self, events):
        self.events = events

    async def stream(self, symbol: str):
        for event in self.events:
            yield event

def normalize_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper().replace("-", "").replace("/", "")
    if not normalized:
        raise ValueError("symbol must not be empty")
    return normalized

def utc_timestamp_ms(value: datetime) -> int:
    if value.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    return int(value.timestamp() * 1000)
