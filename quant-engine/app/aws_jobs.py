from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
import json, os
from .jobs import JobStatus, ResearchJob

class DynamoJobStore:
    def __init__(self, table_name: str | None = None):
        import boto3
        self.client = boto3.resource("dynamodb").Table(table_name or os.environ["RESEARCH_JOB_TABLE"])

    def create(self, job_type: str, payload: dict[str, Any]) -> ResearchJob:
        from uuid import uuid4
        now = datetime.now(timezone.utc)
        job = ResearchJob(f"job_{uuid4().hex}", job_type, payload, created_at=now, updated_at=now)
        self.client.put_item(Item=self._item(job))
        return job

    def get(self, job_id: str) -> ResearchJob | None:
        item = self.client.get_item(Key={"job_id": job_id}).get("Item")
        if not item:
            return None
        return ResearchJob(
            job_id=item["job_id"],
            job_type=item["job_type"],
            payload=json.loads(item["payload"]),
            status=JobStatus(item["status"]),
            result_run_id=item.get("result_run_id"),
            result_s3_key=item.get("result_s3_key"),
            error=item.get("error"),
            created_at=datetime.fromisoformat(item["created_at"]),
            updated_at=datetime.fromisoformat(item["updated_at"]),
        )

    def update(self, job: ResearchJob, **changes) -> ResearchJob:
        for key, value in changes.items():
            setattr(job, key, value)
        job.updated_at = datetime.now(timezone.utc)
        self.client.put_item(Item=self._item(job))
        return job

    @staticmethod
    def _item(job: ResearchJob) -> dict[str, Any]:
        item = {
            "job_id": job.job_id,
            "job_type": job.job_type,
            "payload": json.dumps(job.payload, separators=(",", ":")),
            "status": job.status.value,
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
        }
        if job.result_run_id:
            item["result_run_id"] = job.result_run_id
        if job.result_s3_key:
            item["result_s3_key"] = job.result_s3_key
        if job.error:
            item["error"] = job.error
        return item
