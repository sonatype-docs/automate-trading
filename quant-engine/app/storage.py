from __future__ import annotations
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import pandas as pd
from .data import bars_to_frame, frame_to_bars
from .models import Bar

@dataclass(frozen=True)
class DatasetManifest:
    dataset_id: str
    symbol: str
    timeframe: str
    row_count: int
    start: str
    end: str
    object_key: str
    fingerprint: str

class LocalDatasetStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def put(self, object_key: str, bars: list[Bar]) -> None:
        target = self.root / object_key
        target.parent.mkdir(parents=True, exist_ok=True)
        bars_to_frame(bars).to_parquet(target, index=False)

    def get(self, object_key: str) -> list[Bar]:
        return frame_to_bars(pd.read_parquet(self.root / object_key))

class S3DatasetStore:
    def __init__(self, bucket: str, prefix: str = "market-data"):
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        import boto3
        self.client = boto3.client("s3")

    def _key(self, object_key: str) -> str:
        return f"{self.prefix}/{object_key.lstrip('/')}"

    def put(self, object_key: str, bars: list[Bar]) -> None:
        buffer = BytesIO()
        bars_to_frame(bars).to_parquet(buffer, index=False)
        self.client.put_object(
            Bucket=self.bucket,
            Key=self._key(object_key),
            Body=buffer.getvalue(),
            ContentType="application/vnd.apache.parquet",
        )

    def get(self, object_key: str) -> list[Bar]:
        response = self.client.get_object(Bucket=self.bucket, Key=self._key(object_key))
        return frame_to_bars(pd.read_parquet(BytesIO(response["Body"].read())))
