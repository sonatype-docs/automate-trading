import pandas as pd
from app.dataset_manifest import build_manifest

def test_dataset_manifest_has_stable_provenance_fields():
    frame = pd.DataFrame([
        {"timestamp":"2026-01-01T00:00:00Z","open":100,"high":101,"low":99,"close":100.5,"volume":10},
        {"timestamp":"2026-01-01T01:00:00Z","open":100.5,"high":102,"low":100,"close":101.5,"volume":12},
    ])
    manifest = build_manifest(frame, "btc-1h-20260101", "test", "BTCUSDT", "1h", "s3://bucket/datasets/btc.parquet")
    assert manifest.row_count == 2
    assert len(manifest.content_sha256) == 64
