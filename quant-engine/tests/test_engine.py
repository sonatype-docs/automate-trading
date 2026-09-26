from ._helpers import sample_request
from app.engine import run_backtest

def test_backtest_is_reproducible_shape():
    request = sample_request()
    result = run_backtest(request)
    assert result.run_id.startswith("bt_")
    assert result.metrics.trade_count >= 0
    assert len(result.equity_curve) == len(request.bars) - 19

def test_backtest_includes_costs():
    result = run_backtest(sample_request())
    assert all(t.fees >= 0 for t in result.trades)
