from app.analysis_pipeline import AnalysisRequest, AnalystOutput, RiskSynthesis, TradePlan

def test_analysis_request_accepts_research_contexts():
    request = AnalysisRequest(symbol="BTCUSDT", market_context="macro", sentiment_context="news", technical_context="trend", quant_context="sharpe")
    assert request.symbol == "BTCUSDT"

def test_analysis_output_contracts_are_schema_safe():
    analyst = AnalystOutput(
        stance="NEUTRAL", confidence=0.5, thesis=["insufficient evidence"],
        risks=["event risk"], invalidation=["regime change"], evidence=["supplied context"]
    )
    risk = RiskSynthesis(risk_level="MEDIUM", key_risks=["volatility"], invalidation=["break"], conflicts=[])
    plan = TradePlan(action="NO_TRADE", rationale=["conflicting evidence"], entry_conditions=[], exit_conditions=[], no_trade_conditions=["missing data"])
    assert analyst.confidence == 0.5
    assert risk.risk_level == "MEDIUM"
    assert plan.action == "NO_TRADE"
