from __future__ import annotations
import os
from .aws_jobs import DynamoJobStore
from .sqs_jobs import SQSResearchQueue
from .s3_results import S3ResultStore
from .worker import run_worker

def main():
    queue_url = os.environ["RESEARCH_QUEUE_URL"]
    bucket = os.environ["RESEARCH_RESULTS_BUCKET"]
    job_store = DynamoJobStore(os.environ["RESEARCH_JOB_TABLE"])
    run_worker(SQSResearchQueue(queue_url), S3ResultStore(bucket), job_store)

if __name__ == "__main__":
    main()
