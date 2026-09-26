from app.jobs import InMemoryJobStore, JobStatus

def test_job_lifecycle_store():
    store = InMemoryJobStore()
    job = store.create("backtest", {"symbol": "BTCUSDT"})
    assert job.status == JobStatus.QUEUED
    store.update(job, status=JobStatus.RUNNING)
    assert store.get(job.job_id).status == JobStatus.RUNNING
