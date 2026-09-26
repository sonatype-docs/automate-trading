from ._helpers import sample_request
from app.data import bars_to_frame, frame_to_bars

def test_bar_round_trip():
    bars = sample_request().bars
    frame = bars_to_frame(bars)
    restored = frame_to_bars(frame)
    assert len(restored) == len(bars)
    assert restored[0].timestamp == bars[0].timestamp
    assert restored[-1].close == bars[-1].close
