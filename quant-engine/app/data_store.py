from __future__ import annotations

from io import BytesIO
from urllib.parse import urlparse
import math
import os

import boto3
import pandas as pd

from .models import Bar, BacktestRequest
from .dataset_manifest import REQUIRED_COLUMNS

REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")

def load_bars_from_s3_uri(uri: str) -> list[Bar]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ValueError("dataset_s3_uri must be an s3://bucket/key URI")
    expected_bucket = os.getenv("QUANT_DATA_BUCKET")
    if expected_bucket and parsed.netloc != expected_bucket:
        raise ValueError("dataset URI must use the configured QUANT_DATA_BUCKET")
    key = parsed.path.lstrip("/")
    if not key.startswith("datasets/"):
        raise ValueError("dataset objects must be stored below the datasets/ prefix")
    response = boto3.client("s3").get_object(Bucket=parsed.netloc, Key=key)
    frame = pd.read_parquet(BytesIO(response["Body"].read()))
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError("dataset is missing required columns: " + ", ".join(missing))
    frame = frame.loc[:, list(REQUIRED_COLUMNS)].copy()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    frame = frame.sort_values("timestamp").drop_duplicates("timestamp", keep="last")
    if frame.empty:
        raise ValueError("dataset contains no rows")
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="raise")
        if not frame[column].map(math.isfinite).all():
            raise ValueError("dataset contains non-finite values in " + column)
    if (frame["volume"] < 0).any():
        raise ValueError("dataset volume cannot be negative")
    return [
        Bar(timestamp=row.timestamp.to_pydatetime(), open=float(row.open), high=float(row.high),
            low=float(row.low), close=float(row.close), volume=float(row.volume))
        for row in frame.itertuples(index=False)
    ]

def resolve_bars(request: BacktestRequest) -> BacktestRequest:
    if request.bars:
        if len(request.bars) < 30:
            raise ValueError("backtest requires at least 30 bars")
        return request
    if not request.dataset_s3_uri:
        raise ValueError("provide either bars or dataset_s3_uri")
    bars = load_bars_from_s3_uri(request.dataset_s3_uri)
    if len(bars) < 30:
        raise ValueError("dataset must contain at least 30 bars")
    return request.model_copy(update={"bars": bars})
