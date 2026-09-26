CREATE TABLE IF NOT EXISTS research_runs (
    run_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    dataset_fingerprint CHAR(64) NOT NULL,
    total_return_pct DOUBLE PRECISION NOT NULL,
    annualized_return_pct DOUBLE PRECISION NOT NULL,
    sharpe DOUBLE PRECISION NOT NULL,
    sortino DOUBLE PRECISION NOT NULL,
    profit_factor DOUBLE PRECISION,
    max_drawdown_pct DOUBLE PRECISION NOT NULL,
    win_rate_pct DOUBLE PRECISION NOT NULL,
    expectancy DOUBLE PRECISION NOT NULL,
    trade_count INTEGER NOT NULL,
    UNIQUE (request_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_research_runs_symbol_created
    ON research_runs (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_runs_strategy_created
    ON research_runs (strategy_id, created_at DESC);
