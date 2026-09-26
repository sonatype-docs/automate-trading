from app.risk_gate import ExecutionMode, OrderIntent, RiskGate, RiskLimits

def test_risk_gate_approves_safe_paper_order():
    gate = RiskGate(RiskLimits(1000, 500, 3))
    decision = gate.evaluate(OrderIntent("BTCUSDT","BUY",1,100,ExecutionMode.PAPER), 0, 0, 100)
    assert decision.approved

def test_risk_gate_blocks_live_execution_until_broker_adapter_exists():
    gate = RiskGate(RiskLimits(1000, 500, 3))
    decision = gate.evaluate(OrderIntent("BTCUSDT","BUY",1,100,ExecutionMode.LIVE), 0, 0, 100)
    assert not decision.approved
    assert decision.reason == "live_execution_requires_explicit_broker_adapter"

def test_risk_gate_blocks_daily_loss():
    gate = RiskGate(RiskLimits(1000, 500, 3))
    decision = gate.evaluate(OrderIntent("BTCUSDT","BUY",1,100,ExecutionMode.PAPER), -500, 0, 100)
    assert not decision.approved
