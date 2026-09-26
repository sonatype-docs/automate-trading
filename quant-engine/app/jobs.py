from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"

@dataclass
class ResearchJob:
    job_id: str
    job_type: str
    payload: dict[str, Any]
    status: JobStatus = JobStatus.QUEUED
    result_run_id: str | None = None
    result_s3_key: str | None = None
    error: str | None = None
    created_at: datetime = None
    updated_at: datetime = None

    def __post_init__(self):
        now = datetime.now(timezone.utc)
        self.created_at = self.created_at or now
        self.updated_at = self.updated_at or now

class InMemoryJobStore:
    def __init__(self):
        self._jobs: dict[str, ResearchJob] = {}

    def create(self, job_type: str, payload: dict[str, Any]) -> ResearchJob:
        job = ResearchJob(f"job_{uuid4().hex}", job_type, payload)
        self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> ResearchJob | None:
        return self._jobs.get(job_id)

    def update(self, job: ResearchJob, **changes) -> ResearchJob:
        for key, value in changes.items():
            setattr(job, key, value)
        job.updated_at = datetime.now(timezone.utc)
        self._jobs[job.job_id] = job
        return job
