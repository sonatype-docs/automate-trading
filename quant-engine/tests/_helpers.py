from datetime import datetime, timedelta, timezone
from app.models import BacktestRequest, Bar

def sample_request():
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    bars = []
    price = 100.0
    for i in range(80):
        drift = 0.35 if 20 <= i < 50 else (-0.45 if i >= 50 else 0.05)
        close = price + drift
        bars.append(Bar(timestamp=start + timedelta(days=i), open=price,
            high=max(price, close) + 0.15, low=min(price, close) - 0.15,
            close=close, volume=1000 + i))
        price = close
    return BacktestRequest(symbol="TEST", strategy_id="baseline.breakout", bars=bars)
