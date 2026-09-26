from ._helpers import sample_request
from app.strategy_backtest import run_strategy_backtest

def test_strategy_backtest_uses_strategy_id():
    request = sample_request().model_copy(update={
        "strategy_id": "STRAT-02-TURTLE-DONCHIAN",
        "bars": sample_request().bars + sample_request().bars,
    })
    result = run_strategy_backtest(request)
    assert result.strategy_id == "STRAT-02-TURTLE-DONCHIAN"
    assert result.run_id.startswith("bt_")

def test_pair_and_orderflow_strategies_reject_single_bar_input():
    request = sample_request()
    try:
        run_strategy_backtest(request.model_copy(update={"strategy_id": "STRAT-03-STAT-COINT"}))
        assert False
    except ValueError as exc:
        assert "pair data" in str(exc)
