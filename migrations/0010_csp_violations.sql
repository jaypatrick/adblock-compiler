-- ============================================================================
-- CSP Violations — stores Content-Security-Policy violation reports
-- submitted by browsers via POST /api/csp-report (Page Shield integration).
-- ============================================================================

CREATE TABLE IF NOT EXISTS csp_violations (
    id TEXT PRIMARY KEY,
    document_uri TEXT NOT NULL DEFAULT '',
    blocked_uri TEXT NOT NULL DEFAULT '',
    violated_directive TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_csp_violations_timestamp ON csp_violations(timestamp);
CREATE INDEX IF NOT EXISTS idx_csp_violations_violated_directive ON csp_violations(violated_directive);
