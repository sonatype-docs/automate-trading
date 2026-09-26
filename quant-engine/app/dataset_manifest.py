from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from dataclasses import dataclass
from urllib.parse import urlparse

import boto3
import pandas as pd

REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")

@dataclass(frozen=True)
class DatasetManifest:
    dataset_id: str
    source: str
    symbol: str
    timeframe: str
    row_count: int
    start: str
    end: str
    content_sha256: str
    created_at: str
    s3_uri: str

def _sha256_frame(frame: pd.DataFrame) -> str:
    payload = frame.to_csv(index=False, date_format="iso").encode()
    return sha256(payload).hexdigest()

def build_manifest(frame: pd.DataFrame, dataset_id: str, source: str, symbol: str, timeframe: str, s3_uri: str) -> DatasetManifest:
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        raise ValueError("dataset is missing required columns: " + ", ".join(missing))
    ordered = frame.loc[:, list(REQUIRED_COLUMNS)].copy()
    ordered["timestamp"] = pd.to_datetime(ordered["timestamp"], utc=True)
    ordered = ordered.sort_values("timestamp").drop_duplicates("timestamp", keep="last")
    if ordered.empty:
        raise ValueError("dataset contains no rows")
    return DatasetManifest(
        dataset_id=dataset_id,
        source=source,
        symbol=symbol,
        timeframe=timeframe,
        row_count=len(ordered),
        start=ordered["timestamp"].iloc[0].isoformat(),
        end=ordered["timestamp"].iloc[-1].isoformat(),
        content_sha256=_sha256_frame(ordered),
        created_at=datetime.now(timezone.utc).isoformat(),
        s3_uri=s3_uri,
    )

def write_manifest(manifest: DatasetManifest) -> str:
    parsed = urlparse(manifest.s3_uri)
    if parsed.scheme != "s3":
        raise ValueError("manifest target must be an s3:// URI")
    key = parsed.path.lstrip("/") + ".manifest.json"
    boto3.client("s3").put_object(
        Bucket=parsed.netloc,
        Key=key,
        Body=json.dumps(manifest.__dict__, separators=(",", ":")).encode(),
        ContentType="application/json",
    )
    return f"s3://{parsed.netloc}/{key}"
