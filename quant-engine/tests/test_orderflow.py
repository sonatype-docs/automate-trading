from app.orderflow import (
    Aggressor, BookDelta, BookLevel, OrderBookSnapshot, OrderFlowCalculator,
    TradeTick, classify_trade, replay,
)

def book(ts=1):
    return OrderBookSnapshot(
        timestamp_ms=ts,
        bids=(BookLevel(99.0, 10.0), BookLevel(98.0, 5.0)),
        asks=(BookLevel(101.0, 4.0), BookLevel(102.0, 6.0)),
    )

def test_order_book_reconstruction_and_imbalance():
    calc = OrderFlowCalculator(depth_levels=2)
    features = calc.snapshot(book())
    assert features.best_bid == 99.0
    assert features.best_ask == 101.0
    assert features.bid_depth == 15.0
    assert features.ask_depth == 10.0
    assert features.imbalance == 5.0 / 25.0

def test_cvd_accumulates_aggressor_volume():
    calc = OrderFlowCalculator()
    calc.snapshot(book())
    calc.trade(TradeTick(2, 101.0, 3.0, Aggressor.BUY))
    result = calc.trade(TradeTick(3, 99.0, 1.5, Aggressor.SELL))
    assert result.cumulative_volume_delta == 1.5
    assert result.delta == 1.5

def test_trade_classifier_uses_quote_then_tick_rule():
    assert classify_trade(101.0, 99.0, 101.0) == Aggressor.BUY
    assert classify_trade(99.0, 99.0, 101.0) == Aggressor.SELL
    assert classify_trade(100.0, 99.0, 101.0, 99.5) == Aggressor.BUY

def test_replay_orders_events_deterministically():
    events = replay([book()], [
        TradeTick(3, 101.0, 2.0, Aggressor.BUY),
        TradeTick(2, 99.0, 1.0, Aggressor.SELL),
    ])
    assert [x.timestamp_ms for x in events] == [1, 2, 3]
