-- Ban Prevention Schema for WAHA
-- This initializes the tables needed for warmup tracking and rate limiting

-- Create warmup_stage enum
DO $$ BEGIN
    CREATE TYPE warmup_stage AS ENUM (
        'PHASE_1_PROFILE',
        'PHASE_2_RECEIVE',
        'PHASE_3_LIMITED',
        'PHASE_4_GRADUAL',
        'COMPLETED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Warmup configuration per session
CREATE TABLE IF NOT EXISTS warmup_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name VARCHAR(255) UNIQUE NOT NULL,
    stage warmup_stage NOT NULL DEFAULT 'PHASE_1_PROFILE',
    start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    daily_quota INTEGER NOT NULL DEFAULT 0,
    last_reset TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Recipient rate limiting
CREATE TABLE IF NOT EXISTS recipient_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name VARCHAR(255) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(session_name, recipient)
);

-- Safety metrics for monitoring
CREATE TABLE IF NOT EXISTS safety_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name VARCHAR(255) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    messages_sent INTEGER NOT NULL DEFAULT 0,
    messages_delivered INTEGER NOT NULL DEFAULT 0,
    messages_failed INTEGER NOT NULL DEFAULT 0,
    unique_recipients INTEGER NOT NULL DEFAULT 0,
    responses_received INTEGER NOT NULL DEFAULT 0,
    UNIQUE(session_name, date)
);

-- Message log for analytics
CREATE TABLE IF NOT EXISTS message_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name VARCHAR(255) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    message_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_warmup_configs_session ON warmup_configs(session_name);
CREATE INDEX IF NOT EXISTS idx_recipient_rate_limits_session ON recipient_rate_limits(session_name);
CREATE INDEX IF NOT EXISTS idx_recipient_rate_limits_lookup ON recipient_rate_limits(session_name, recipient);
CREATE INDEX IF NOT EXISTS idx_safety_metrics_session_date ON safety_metrics(session_name, date);
CREATE INDEX IF NOT EXISTS idx_message_logs_session ON message_logs(session_name);
CREATE INDEX IF NOT EXISTS idx_message_logs_sent_at ON message_logs(sent_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for warmup_configs
DROP TRIGGER IF EXISTS update_warmup_configs_updated_at ON warmup_configs;
CREATE TRIGGER update_warmup_configs_updated_at
    BEFORE UPDATE ON warmup_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
