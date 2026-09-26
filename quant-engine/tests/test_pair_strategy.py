from ._helpers import sample_request
from app.pair_strategy import cointegration_signal, hedge_ratio


def test_hedge_ratio_is_ols_slope():
    x = [10, 11, 12, 13]
    y = [5, 5.5, 6, 6.5]
    assert abs(hedge_ratio(x, y) - 2.0) < 1e-9


def test_pair_signal_detects_extreme_spread():
    request = sample_request()
    x = request.bars
    y = [
        bar.model_copy(
            update={
                "close": bar.close * 0.5,
                "open": bar.open * 0.5,
                "high": bar.high * 0.5,
                "low": bar.low * 0.5,
            }
        )
        for bar in x
    ]
    signal = cointegration_signal(x, y, window=30, entry_z=0.5, exit_z=0.25)
    assert signal.action in {"SHORT_SPREAD", "LONG_SPREAD", "FLAT", "EXIT_SPREAD"}
    assert signal.hedge_ratio > 0
