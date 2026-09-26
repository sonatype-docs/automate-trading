from datetime import datetime, timezone
import os
from fastapi import FastAPI, HTTPException, Header
from .engine import run_backtest
from .models import BacktestRequest, BacktestResult
from .research import parameter_sweep, walk_forward
from .strategy_registry import get_strategy, list_strategies
from .strategy_backtest import run_strategy_backtest
from .jobs import InMemoryJobStore
from .auth import require_auth
from .data_store import resolve_bars
from .analysis_pipeline import AnalysisRequest
from .pair_backtest import run_pair_backtest
from .orderflow_api import ReplayRequest, run_replay
from pydantic import BaseModel, Field
from .models import Bar
_JOBS = InMemoryJobStore()

def _job_store():
    if os.getenv("RESEARCH_JOB_TABLE"):
        from .aws_jobs import DynamoJobStore
        return DynamoJobStore()
    return _JOBS

app = FastAPI(title="QUANT-TRADER Quant Engine", version="0.5.0")
_RESULTS = {}

def _require_auth(authorization: str | None, api_key: str | None):
    return require_auth(authorization, api_key)

@app.get("/health")
def health():
    return {"status": "ok", "service": "quant-engine", "time": datetime.now(timezone.utc).isoformat()}

@app.get("/v1/research/strategies")
def strategies(authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    return [{"strategy_id": item.strategy_id, "name": item.name, "description": item.description} for item in list_strategies()]

@app.post("/v1/research/backtests", response_model=BacktestResult, status_code=201)
def create_backtest(request: BacktestRequest, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    try:
        result = run_strategy_backtest(resolve_bars(request))
        _RESULTS[result.run_id] = result
        return result
    except (ValueError, OverflowError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

@app.get("/v1/research/backtests/{run_id}", response_model=BacktestResult)
def get_backtest(run_id: str, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    result = _RESULTS.get(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return result

class PairBacktestRequest(BaseModel):
    x_symbol: str = Field(min_length=1, max_length=32)
    y_symbol: str = Field(min_length=1, max_length=32)
    x_bars: list[Bar] = Field(min_length=30)
    y_bars: list[Bar] = Field(min_length=30)
    initial_capital: float = Field(default=25_000, gt=0)
    risk_per_trade: float = Field(default=0.01, gt=0, lt=1)
    fee_bps: float = Field(default=4.0, ge=0)
    slippage_bps: float = Field(default=1.0, ge=0)
    window: int = Field(default=60, ge=20, le=1000)
    entry_z: float = Field(default=2.0, gt=0, le=10)
    exit_z: float = Field(default=0.0, ge=0, lt=10)

@app.post("/v1/research/pairs/backtests")
def create_pair_backtest(request: PairBacktestRequest, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    try:
        return run_pair_backtest(
            request.x_symbol, request.y_symbol, request.x_bars, request.y_bars,
            request.initial_capital, request.risk_per_trade, request.fee_bps,
            request.slippage_bps, request.window, request.entry_z, request.exit_z,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

@app.post("/v1/research/orderflow/replay")
def create_orderflow_replay(request: ReplayRequest, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    return run_replay(request)

@app.post("/v1/research/sweeps")
def create_sweep(request: BacktestRequest, parameter_grid: dict[str, list[float]], authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    get_strategy(request.strategy_id)
    return parameter_sweep(request, parameter_grid)

@app.post("/v1/research/walk-forward")
def create_walk_forward(
    request: BacktestRequest,
    train_bars: int,
    test_bars: int,
    step_bars: int | None = None,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    _require_auth(authorization, x_api_key)
    get_strategy(request.strategy_id)
    return walk_forward(request, train_bars, test_bars, step_bars)

@app.post("/v1/research/jobs", status_code=202)
def create_research_job(request: BacktestRequest, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    request = resolve_bars(request)
    job = _job_store().create("backtest", request.model_dump(mode="json"))
    if os.getenv("RESEARCH_QUEUE_URL"):
        from .research_dispatch import ResearchDispatcher
        message_id = ResearchDispatcher(os.environ["RESEARCH_QUEUE_URL"]).dispatch(job)
        return {"job_id": job.job_id, "status": job.status, "created_at": job.created_at, "message_id": message_id}
    return {"job_id": job.job_id, "status": job.status, "created_at": job.created_at}

@app.get("/v1/research/jobs/{job_id}")
def get_research_job(job_id: str, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    job = _job_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job

@app.get("/v1/research/jobs/{job_id}/result")
def get_research_job_result(job_id: str, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    job = _job_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job.status != "SUCCEEDED" or not job.result_s3_key:
        raise HTTPException(status_code=409, detail="research result is not ready")
    from .s3_results import S3ResultStore
    bucket = os.getenv("RESEARCH_RESULTS_BUCKET") or os.getenv("QUANT_DATA_BUCKET")
    if not bucket:
        raise HTTPException(status_code=503, detail="research result bucket is not configured")
    return S3ResultStore(bucket).get(job.result_s3_key)

@app.post("/v1/analysis/jobs", status_code=202)
def create_analysis_job(request: AnalysisRequest, authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)):
    _require_auth(authorization, x_api_key)
    if not os.getenv("BEDROCK_MODEL_ID"):
        raise HTTPException(status_code=503, detail="BEDROCK_MODEL_ID is not configured")
    job = _job_store().create("analysis_pipeline", request.model_dump(mode="json"))
    if not os.getenv("RESEARCH_QUEUE_URL"):
        raise HTTPException(status_code=503, detail="research queue is not configured")
    from .research_dispatch import ResearchDispatcher
    message_id = ResearchDispatcher(os.environ["RESEARCH_QUEUE_URL"]).dispatch(job)
    return {"job_id": job.job_id, "status": job.status, "created_at": job.created_at, "message_id": message_id}
