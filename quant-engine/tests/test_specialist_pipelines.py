from datetime import datetime, timedelta, timezone

from app.models import Bar
from app.orderflow import Aggressor
from app.orderflow_api import ReplayRequest, SnapshotIn, LevelIn, TradeIn, run_replay
from app.pair_backtest import run_pair_backtest
from app.pair_strategy import cointegration_signal


def make_pair_bars(count: int = 140) -> tuple[list[Bar], list[Bar]]:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    x_bars: list[Bar] = []
    y_bars: list[Bar] = []
    for i in range(count):
        ts = start + timedelta(minutes=15 * i)
        y = 100.0 + i * 0.1
        spread = 2.8 * __import__("math").sin(i / 4.0)
        x = 200.0 + i * 0.2 + spread
        y_bars.append(Bar(timestamp=ts, open=y, high=y + 0.2, low=y - 0.2, close=y, volume=1000))
        x_bars.append(Bar(timestamp=ts, open=x, high=x + 0.3, low=x - 0.3, close=x, volume=1000))
    return x_bars, y_bars


def test_pair_signal_rejects_exit_threshold_at_or_above_entry() -> None:
    x, y = make_pair_bars(70)
    try:
        cointegration_signal(x, y, window=60, entry_z=2.0, exit_z=2.0)
    except ValueError as exc:
        assert "exit_z" in str(exc)
    else:
        raise AssertionError("expected invalid threshold to raise")


def test_pair_backtest_returns_reproducible_parameters_and_trades() -> None:
    x, y = make_pair_bars()
    result = run_pair_backtest("XAUUSDT", "BTCUSDT", x, y)
    assert result["engine_version"] == "0.5.0"
    assert result["parameters"]["window"] == 60
    assert result["parameters"]["entry_z"] == 2.0
    assert result["parameters"]["exit_z"] == 0.5
    assert result["metrics"]["trade_count"] >= 1


def test_orderflow_replay_activates_absorption_signal() -> None:
    request = ReplayRequest(
        snapshots=[
            SnapshotIn(
                timestamp_ms=1,
                bids=[LevelIn(price=100.0, quantity=10.0)],
                asks=[LevelIn(price=101.0, quantity=30.0)],
            )
        ],
        trades=[
            TradeIn(timestamp_ms=2, price=101.0, quantity=5.0, aggressor=Aggressor.BUY),
            TradeIn(timestamp_ms=3, price=101.0, quantity=5.0, aggressor=Aggressor.BUY),
        ],
        imbalance_threshold=0.2,
    )
    result = run_replay(request)
    assert result["event_count"] == 3
    assert result["last"]["signal"] == "SHORT"
    assert result["last"]["cumulative_volume_delta"] == 10.0
