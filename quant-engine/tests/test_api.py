from fastapi.testclient import TestClient
from app.main import app
from ._helpers import sample_request

def test_health():
    assert TestClient(app).get("/health").status_code == 200

def test_create_and_fetch_backtest(monkeypatch):
    monkeypatch.setenv("QUANT_ENGINE_API_KEY", "test-key")
    client = TestClient(app)
    headers = {"X-API-Key": "test-key"}
    request = sample_request().model_copy(update={"strategy_id": "STRAT-02-TURTLE-DONCHIAN", "bars": sample_request().bars * 2})
    created = client.post("/v1/research/backtests", json=request.model_dump(mode="json"), headers=headers)
    assert created.status_code == 201
    run_id = created.json()["run_id"]
    fetched = client.get("/v1/research/backtests/" + run_id, headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["run_id"] == run_id
