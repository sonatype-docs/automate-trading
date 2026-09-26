from __future__ import annotations
import json

class SQSResearchQueue:
    def __init__(self, queue_url: str):
        import boto3
        self.queue_url = queue_url
        self.client = boto3.client("sqs")

    def enqueue(self, job_id: str, job_type: str, payload: dict) -> str:
        response = self.client.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps({"job_id": job_id, "job_type": job_type, "payload": payload}, separators=(",", ":")),
        )
        return response["MessageId"]

    def receive(self, max_messages: int = 1):
        response = self.client.receive_message(
            QueueUrl=self.queue_url,
            MaxNumberOfMessages=max(1, min(max_messages, 10)),
            WaitTimeSeconds=10,
            VisibilityTimeout=900,
        )
        return response.get("Messages", [])

    def delete(self, receipt_handle: str) -> None:
        self.client.delete_message(QueueUrl=self.queue_url, ReceiptHandle=receipt_handle)
