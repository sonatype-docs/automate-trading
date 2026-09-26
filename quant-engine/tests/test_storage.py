from ._helpers import sample_request
from app.storage import LocalDatasetStore

def test_local_dataset_store_round_trip(tmp_path):
    request = sample_request()
    store = LocalDatasetStore(tmp_path)
    store.put("TEST/1d/2025.parquet", request.bars)
    restored = store.get("TEST/1d/2025.parquet")
    assert len(restored) == len(request.bars)
    assert restored[10].close == request.bars[10].close
