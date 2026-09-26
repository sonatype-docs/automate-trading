def test_dynamo_job_store_imports():
    from app.aws_jobs import DynamoJobStore
    assert DynamoJobStore
