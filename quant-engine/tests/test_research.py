from ._helpers import sample_request
from app.research import parameter_sweep, walk_forward

def test_parameter_sweep_returns_every_combination():
    request = sample_request().model_copy(update={"strategy_id": "STRAT-02-TURTLE-DONCHIAN", "bars": sample_request().bars * 2})
    results = parameter_sweep(request, {"fee_bps": [0.0, 4.0], "slippage_bps": [0.0, 1.0]})
    assert len(results) == 4
    assert all(item.result.strategy_id == "STRAT-02-TURTLE-DONCHIAN" for item in results)

def test_parameter_sweep_rejects_unknown_fields():
    try:
        parameter_sweep(sample_request(), {"donchian_period": [20]})
        assert False
    except ValueError as exc:
        assert "unsupported sweep fields" in str(exc)

def test_walk_forward_creates_out_of_sample_windows_with_strategy_engine():
    request = sample_request().model_copy(update={"strategy_id": "STRAT-02-TURTLE-DONCHIAN", "bars": sample_request().bars * 4})
    windows = walk_forward(request, train_bars=30, test_bars=30, step_bars=30)
    assert windows
    assert all(window.test_end > window.test_start for window in windows)
    assert all(window.result.strategy_id == "STRAT-02-TURTLE-DONCHIAN" for window in windows)

from app.data_store import resolve_bars

def test_inline_bars_remain_supported_for_research():
    request = sample_request()
    assert len(resolve_bars(request).bars) >= 30

def test_research_requires_bars_or_dataset_reference():
    request = sample_request().model_copy(update={"bars": [], "dataset_s3_uri": None})
    try:
        resolve_bars(request)
        assert False
    except ValueError as exc:
        assert "dataset_s3_uri" in str(exc)
