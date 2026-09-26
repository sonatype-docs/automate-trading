from __future__ import annotations
import json
import logging
from .strategy_backtest import run_strategy_backtest
from .models import BacktestRequest
from .s3_results import S3ResultStore
from .jobs import JobStatus
from .data_store import resolve_bars
from .analysis_pipeline import AnalystPipeline, AnalysisRequest

logger = logging.getLogger(__name__)

def execute_job(message: dict, result_store: S3ResultStore, job_store=None) -> str:
    job_id = message["job_id"]
    if job_store is not None:
        job = job_store.get(job_id)
        if job is None:
            raise ValueError(f"research job not found: {job_id}")
        job_store.update(job, status=JobStatus.RUNNING, error=None)

    try:
        job_type = message["job_type"]
        if job_type == "backtest":
            request = resolve_bars(BacktestRequest.model_validate(message["payload"]))
            result = run_strategy_backtest(request)
            result_key = result_store.put(result)
            result_run_id = result.run_id
        elif job_type == "analysis_pipeline":
            result = __import__("asyncio").run(AnalystPipeline().run(AnalysisRequest.model_validate(message["payload"])))
            result_run_id = result.pipeline_id
            result_key = result_store.put_json(result_run_id, result.model_dump(mode="json"))
        else:
            raise ValueError(f"unsupported job_type: {job_type}")
        if job_store is not None:
            job_store.update(
                job,
                status=JobStatus.SUCCEEDED,
                result_run_id=result_run_id,
                result_s3_key=result_key,
                error=None,
            )
        return result_key
    except Exception as exc:
        if job_store is not None:
            job_store.update(job, status=JobStatus.FAILED, error=str(exc))
        raise

def run_worker(queue, result_store, job_store=None) -> None:
    while True:
        messages = queue.receive(10)
        if not messages:
            continue
        for message in messages:
            try:
                body = json.loads(message["Body"])
                execute_job(body, result_store, job_store)
                queue.delete(message["ReceiptHandle"])
            except Exception:
                logger.exception("research job failed; leaving message for retry/DLQ")
