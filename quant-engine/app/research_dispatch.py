from .sqs_jobs import SQSResearchQueue
from .jobs import ResearchJob
class ResearchDispatcher:
    def __init__(self, queue_url: str):
        self.queue=SQSResearchQueue(queue_url)
    def dispatch(self, job: ResearchJob) -> str:
        return self.queue.enqueue(job.job_id,job.job_type,job.payload)
