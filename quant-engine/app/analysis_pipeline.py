from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import boto3
from botocore.config import Config
from pydantic import BaseModel, Field

class AnalysisRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    market_context: str = ""
    sentiment_context: str = ""
    technical_context: str = ""
    quant_context: str = ""

class AnalystOutput(BaseModel):
    stance: str
    confidence: float
    thesis: list[str]
    risks: list[str]
    invalidation: list[str]
    evidence: list[str]

class RiskSynthesis(BaseModel):
    risk_level: str
    key_risks: list[str]
    invalidation: list[str]
    conflicts: list[str]

class TradePlan(BaseModel):
    action: str
    rationale: list[str]
    entry_conditions: list[str]
    exit_conditions: list[str]
    no_trade_conditions: list[str]

class AnalysisPipelineResult(BaseModel):
    pipeline_id: str
    created_at: datetime
    symbol: str
    model_id: str
    analysts: dict[str, AnalystOutput]
    risk_synthesis: RiskSynthesis
    trade_plan: TradePlan

_ANALYST_SCHEMA = {
    "type": "object",
    "properties": {
        "stance": {"type": "string", "enum": ["BULLISH", "BEARISH", "NEUTRAL"]},
        "confidence": {"type": "number"},
        "thesis": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "invalidation": {"type": "array", "items": {"type": "string"}},
        "evidence": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["stance", "confidence", "thesis", "risks", "invalidation", "evidence"],
    "additionalProperties": False,
}
_RISK_SCHEMA = {
    "type": "object",
    "properties": {
        "risk_level": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "EXTREME"]},
        "key_risks": {"type": "array", "items": {"type": "string"}},
        "invalidation": {"type": "array", "items": {"type": "string"}},
        "conflicts": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["risk_level", "key_risks", "invalidation", "conflicts"],
    "additionalProperties": False,
}
_TRADE_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["LONG_BIAS", "SHORT_BIAS", "NO_TRADE"]},
        "rationale": {"type": "array", "items": {"type": "string"}},
        "entry_conditions": {"type": "array", "items": {"type": "string"}},
        "exit_conditions": {"type": "array", "items": {"type": "string"}},
        "no_trade_conditions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["action", "rationale", "entry_conditions", "exit_conditions", "no_trade_conditions"],
    "additionalProperties": False,
}

class AnalystPipeline:
    def __init__(self, region: str | None = None, model_id: str | None = None):
        self.region = region or os.getenv("AWS_REGION", "ap-south-1")
        self.model_id = model_id or os.getenv("BEDROCK_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=self.region,
            config=Config(retries={"max_attempts": 5, "mode": "adaptive"}),
        )

    def _invoke(self, system: str, prompt: str, schema: dict[str, Any], name: str) -> dict[str, Any]:
        response = self.client.converse(
            modelId=self.model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 1200, "temperature": 0.2},
            outputConfig={
                "textFormat": {
                    "type": "json_schema",
                    "structure": {
                        "jsonSchema": {
                            "schema": __import__("json").dumps(schema, separators=(",", ":")),
                            "name": name,
                            "description": name,
                        }
                    },
                }
            },
        )
        text = response["output"]["message"]["content"][0]["text"]
        return __import__("json").loads(text)

    async def run(self, request: AnalysisRequest) -> AnalysisPipelineResult:
        base = (
            f"Symbol: {request.symbol}\n"
            f"Market context:\n{request.market_context}\n"
            f"Sentiment context:\n{request.sentiment_context}\n"
            f"Technical context:\n{request.technical_context}\n"
            f"Quant context:\n{request.quant_context}"
        )
        analyst_specs = {
            "market_research": "Analyze macro, fundamental, liquidity and market-structure context. Use only supplied evidence; identify missing evidence explicitly.",
            "sentiment": "Analyze supplied news/social/sentiment context. Separate observed signals from interpretation and identify event-driven risks.",
            "technical": "Analyze supplied technical and quantitative context. Focus on trend, volatility, momentum, support/resistance and regime evidence.",
        }
        async def analyst(name: str, role: str):
            return name, AnalystOutput.model_validate(await asyncio.to_thread(
                self._invoke,
                role,
                base + "\nProduce a disciplined analyst packet with no invented facts.",
                _ANALYST_SCHEMA,
                "analyst_packet",
            ))
        analyst_pairs = await asyncio.gather(*(analyst(name, role) for name, role in analyst_specs.items()))
        analysts = dict(analyst_pairs)
        synthesis_input = base + "\nAnalyst packets:\n" + __import__("json").dumps(
            {k: v.model_dump(mode="json") for k, v in analysts.items()}, separators=(",", ":")
        )
        risk_raw, trade_raw = await asyncio.gather(
            asyncio.to_thread(
                self._invoke,
                "You are the risk synthesis agent. Reconcile the three analyst packets, surface conflicts, and define explicit invalidation conditions.",
                synthesis_input,
                _RISK_SCHEMA,
                "risk_synthesis",
            ),
            asyncio.to_thread(
                self._invoke,
                "You are the trade-plan synthesis agent. Convert the analyst packets into scenario-based conditions. Do not invent prices or facts; choose NO_TRADE when evidence conflicts or is insufficient.",
                synthesis_input,
                _TRADE_SCHEMA,
                "trade_plan",
            ),
        )
        return AnalysisPipelineResult(
            pipeline_id="analysis_" + uuid4().hex,
            created_at=datetime.now(timezone.utc),
            symbol=request.symbol,
            model_id=self.model_id,
            analysts=analysts,
            risk_synthesis=RiskSynthesis.model_validate(risk_raw),
            trade_plan=TradePlan.model_validate(trade_raw),
        )
