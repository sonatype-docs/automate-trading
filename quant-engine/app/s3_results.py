from __future__ import annotations
import json
from .models import BacktestResult

class S3ResultStore:
    def __init__(self, bucket: str, prefix: str = "research-results"):
        import boto3
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.client = boto3.client("s3")

    def _key(self, result: BacktestResult) -> str:
        return f"{self.prefix}/{result.created_at:%Y/%m/%d}/{result.strategy_id}/{result.run_id}.json"

    def put(self, result: BacktestResult) -> str:
        key = self._key(result)
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(result.model_dump(mode="json"), separators=(",", ":")).encode(),
            ContentType="application/json",
        )
        return key

    def get(self, key: str) -> dict:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return json.loads(response["Body"].read())

    def put_json(self, run_id: str, payload: dict, category: str = "analysis") -> str:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        key = f"{self.prefix}/{category}/{now:%Y/%m/%d}/{run_id}.json"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(payload, separators=(",", ":")).encode(),
            ContentType="application/json",
        )
        return key
