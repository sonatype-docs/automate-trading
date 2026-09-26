# QUANT-TRADER Quant Engine

The quant engine is the server-side research and execution-safety component of the existing QUANT-TRADER product. It lives inside the same repository as the Android cockpit.

## Implemented capabilities

- FastAPI research API with Cognito authentication and development API-key fallback.
- Deterministic baseline and executable strategy backtesting for the strategy registry.
- Canonical OHLCV validation, S3/Parquet datasets, dataset manifests, fingerprints, and provenance.
- Parameter sweeps and walk-forward research.
- Pair/cointegration research with explicit hedge-ratio orientation.
- L2/order-flow primitives, deterministic replay, CVD, imbalance, absorption, and order-flow strategy rules.
- Durable asynchronous research jobs backed by DynamoDB + SQS + ECS workers.
- S3 result persistence and a result retrieval API.
- Structured five-stage Bedrock analyst pipeline with persisted results.
- Paper/live execution risk boundary. Live broker execution is intentionally blocked until an explicit broker adapter exists.
- AWS deployment via the root repository's CloudFormation stack and GitHub Actions.

## API

- GET `/health`
- GET `/v1/research/strategies`
- POST `/v1/research/backtests`
- GET `/v1/research/backtests/{run_id}`
- POST `/v1/research/sweeps`
- POST `/v1/research/walk-forward`
- POST `/v1/research/jobs`
- GET `/v1/research/jobs/{job_id}`
- GET `/v1/research/jobs/{job_id}/result`
- POST `/v1/analysis/jobs`

## Product boundary

Android remains the cockpit. Long-running research and analysis execute server-side so UI code does not manufacture research metrics.

Production flow:

Android → Cognito → API → DynamoDB/SQS → ECS worker → S3 result → Android.

The engine is deliberately an in-repository module rather than a separate repository.
