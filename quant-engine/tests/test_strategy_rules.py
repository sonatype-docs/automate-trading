from datetime import datetime, timezone, timedelta
from app.models import Bar
from app.strategy_rules import (
    london_orb, turtle_donchian, vwap_reversion, dual_momentum,
)

def bars(prices):
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return [
        Bar(timestamp=start + timedelta(minutes=i), open=p, high=p + .1, low=p - .1, close=p, volume=1000)
        for i, p in enumerate(prices)
    ]

def test_london_orb_breaks_range():
    data = bars([100.0] * 20 + [101.0])
    assert london_orb(data).action == "LONG"

def test_turtle_breaks_previous_channel():
    data = bars([100.0] * 20 + [101.0])
    assert turtle_donchian(data).action == "LONG"

def test_vwap_reversion_detects_upper_extension():
    data = bars([100.0] * 19 + [110.0])
    assert vwap_reversion(data, threshold=1.0).action == "SHORT"

def test_dual_momentum_aligns_up():
    data = bars([100 + i * .5 for i in range(70)])
    assert dual_momentum(data).action == "LONG"
