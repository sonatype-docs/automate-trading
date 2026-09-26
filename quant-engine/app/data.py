from __future__ import annotations
from datetime import datetime
from pathlib import Path
import pandas as pd
from .models import Bar

COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")

def bars_to_frame(bars: list[Bar]) -> pd.DataFrame:
    frame = pd.DataFrame([bar.model_dump() for bar in bars], columns=COLUMNS)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    return frame.sort_values("timestamp").reset_index(drop=True)

def frame_to_bars(frame: pd.DataFrame) -> list[Bar]:
    missing = [column for column in COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    ordered = frame.loc[:, COLUMNS].copy()
    ordered["timestamp"] = pd.to_datetime(ordered["timestamp"], utc=True)
    if ordered.duplicated("timestamp").any():
        raise ValueError("Duplicate timestamps are not allowed")
    if (ordered[["high", "low", "close", "open"]] <= 0).any().any():
        raise ValueError("OHLC prices must be positive")
    if (ordered["volume"] < 0).any():
        raise ValueError("Volume cannot be negative")
    return [Bar(timestamp=row.timestamp.to_pydatetime(), open=float(row.open),
        high=float(row.high), low=float(row.low), close=float(row.close),
        volume=float(row.volume)) for row in ordered.itertuples(index=False)]

def write_parquet(bars: list[Bar], path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    bars_to_frame(bars).to_parquet(target, index=False)

def read_parquet(path: str | Path) -> list[Bar]:
    return frame_to_bars(pd.read_parquet(path))
