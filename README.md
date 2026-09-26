# QUANT-BOT

QUANT-BOT is a quantitative research, backtesting, trading, risk, analytics, and reporting workspace.

## Production

AWS is the only supported production runtime.

Every push to `main` that changes the application or deployment inputs can invoke:

`/.github/workflows/deploy-aws.yml`

The production workflow builds the application and quant-engine images, publishes immutable images to Amazon ECR, updates the CloudFormation stack `shark-auto-trader-runtime`, runs the idempotent database bootstrap migration, waits for ECS stability, invalidates CloudFront, and runs live readiness/smoke checks.

Production region: **AWS Sydney (ap-southeast-2)**.

## Architecture

- **Edge:** Amazon CloudFront
- **Application:** Application Load Balancer + Amazon ECS/Fargate
- **Database:** Amazon RDS PostgreSQL
- **Identity:** Amazon Cognito
- **Files and artifacts:** Amazon S3
- **Research jobs:** Amazon SQS + DynamoDB + isolated ECS quant workers
- **AI research:** Amazon Bedrock
- **Monitoring:** Amazon CloudWatch

The repository is the source of truth. Production releases are driven from GitHub Actions and the AWS deployment workflow.

## Local development

Requirements: Bun and a recent Node.js runtime.

```sh
bun install
bun run dev
```

For an AWS-style production build:

```sh
bun run build:aws
```

Run tests with:

```sh
bun run test
```
