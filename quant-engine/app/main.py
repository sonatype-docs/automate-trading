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
_JOBS = InMemoryJobStore()

def _job_store():
    if os.getenv("RESEARCH_JOB_TABLE"):
        from .aws_jobs import DynamoJobStore
        return DynamoJobStore()
    return _JOBS

app = FastAPI(title="QUANT-TRADER Quant Engine", version="0.4.0")
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
