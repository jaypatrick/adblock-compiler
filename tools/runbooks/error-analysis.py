"""
Error Log Analysis with Claude AI

Demonstrates the logs → analysis → PR/repair automation pipeline.
This notebook shows how to:
1. Fetch error logs from CloudFlare Workers or database
2. Send to Claude for AI-powered analysis
3. Generate actionable fixes
4. (With approval) Create a GitHub PR with the fix

This exemplifies "zero context switching" — all debugging happens
in marimo without leaving the notebook.
"""

import marimo as mo
from datetime import datetime, timedelta
import json
from typing import Any

__version__ = "1.0.0"


@mo.cache
def load_error_logs(hours: int = 24) -> list[dict]:
    """
    Fetch error logs from the past N hours.
    In production: Query CloudFlare Workers logs, D1, or Postgres.
    """
    # Mock data for demo
    return [
        {
            "timestamp": (datetime.now() - timedelta(hours=2)).isoformat(),
            "level": "ERROR",
            "service": "compile-api",
            "message": "Timeout: ruleset compilation exceeded 30s",
            "context": {"ruleset_id": "adguard-default", "rules_count": 50000},
            "stack": "Error: Timeout at compilationPipeline.run() [line 234]",
        },
        {
            "timestamp": (datetime.now() - timedelta(hours=5)).isoformat(),
            "level": "ERROR",
            "service": "rule-validator",
            "message": "Invalid rule syntax at line 1234: malformed domain list",
            "context": {"source": "custom-filter", "user_id": "user-456"},
            "stack": "ValidationError: Expected format 'domain1.com, domain2.com'",
        },
        {
            "timestamp": (datetime.now() - timedelta(hours=18)).isoformat(),
            "level": "WARN",
            "service": "download-manager",
            "message": "Retry exhausted for https://example.com/rules.txt (3/3 attempts)",
            "context": {"url": "https://example.com/rules.txt", "status": 503},
            "stack": "NetworkError: Service Unavailable",
        },
    ]


@mo.cache
def load_recent_issues() -> list[dict]:
    """
    Fetch recent GitHub issues to avoid duplicate analysis.
    In production: Query GitHub API.
    """
    return [
        {
            "number": 1728,
            "title": "Timeout errors on large rulesets (>50k rules)",
            "state": "open",
            "created_at": "2026-04-28",
        },
    ]


app = mo.App(
    title="🔍 Error Log Analysis with Claude",
    description="AI-powered root cause analysis, anomaly detection, and fix generation",
)


@app.cell
def _header():
    """Page header."""
    return mo.md("""
    # 🔍 Error Log Analysis with Claude
    
    Automatically analyze error logs and generate recommended fixes.
    
    **Pipeline:** Error Logs → Claude Analysis → Root Cause → Fix Suggestion → PR (with approval)
    
    [Back to Dashboard](dashboard.py) | [Deployment Guide](../DEPLOYMENT.md)
    """)


@app.cell
def _error_log_viewer():
    """Display recent errors with filtering."""
    import marimo as mo

    errors = load_error_logs(hours=24)

    # Separate by level for visual hierarchy
    error_list = ""
    for err in errors:
        level_color = {
            "ERROR": "#ef4444",
            "WARN": "#f59e0b",
            "INFO": "#3b82f6",
        }.get(err["level"], "#6b7280")

        error_list += f"""
        <div style="
            border-left: 4px solid {level_color};
            padding: 1rem;
            margin-bottom: 1rem;
            background: #f9fafb;
            border-radius: 0.375rem;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <strong style="color: {level_color}">[{err["level"]}]</strong>
                <span style="font-size: 0.875rem; color: #6b7280;">{err["timestamp"]}</span>
            </div>
            <div style="font-weight: 600; margin-bottom: 0.5rem;">{err["service"]}</div>
            <div style="color: #374151; font-family: monospace; font-size: 0.875rem;">
                {err["message"]}
            </div>
        </div>
        """

    return mo.md(f"""
    ## 📋 Recent Errors (Last 24h)
    
    **Total:** {len(errors)} errors
    
    {mo.html(error_list).value if error_list else "No errors recorded."}
    """)


@app.cell
def _analyze_button_and_prompt():
    """Button to trigger Claude analysis."""
    import marimo as mo

    analyze_button = mo.ui.button(label="🤖 Analyze with Claude", actions={"click": ["analyze"]})

    prompt_template = mo.ui.textarea(
        label="Custom Analysis Prompt (optional)",
        value="""Analyze these error logs and provide:
1. **Root Causes** - what went wrong and why
2. **Impact** - how many users affected, severity
3. **Actionable Fixes** - concrete steps to prevent/fix
4. **PR Summary** - suggested GitHub issue title and description

Format as markdown with code examples where relevant.""",
        rows=10,
    )

    return mo.vstack(
        [
            mo.md("## 🚀 AI Analysis"),
            analyze_button,
            mo.md("### Customize the analysis prompt"),
            prompt_template,
        ]
    )


@app.cell
def _llm_integration():
    """
    Integrate with Claude for error analysis.

    NOTE: In a real runbook, this cell would:
    1. Call Claude API with error logs
    2. Stream results back
    3. Parse structured output (root causes, fixes, PR draft)
    4. Display in marimo UI
    """
    import marimo as mo
    import os

    # This is a mock implementation; replace with actual Claude API call
    # In production: from anthropic import Anthropic

    def analyze_errors_with_claude(errors: list, custom_prompt: str = None) -> dict:
        """
        Call Claude Sonnet to analyze errors.

        Returns: {
            "root_causes": ["..."],
            "impact": "High/Medium/Low",
            "fixes": ["..."],
            "issue_title": "...",
            "issue_body": "...",
        }
        """
        # Mock response (replace with actual Claude API in production)
        return {
            "root_causes": [
                "Large ruleset (>50k rules) exceeds 30s timeout threshold in compilation pipeline",
                "No streaming/chunking strategy for rule processing",
                "Database query N+1 problems during validation step",
            ],
            "impact": "High - affects users with custom large filter lists",
            "fixes": [
                "Implement streaming compilation for rulesets >50k",
                "Add async batch processing to rule validator",
                "Implement connection pooling in D1 queries",
                "Add metrics/tracing to identify exact bottleneck",
            ],
            "issue_title": "Implement streaming compilation for large rulesets (>50k rules)",
            "issue_body": """## Problem
Users with large custom filter lists experience timeout errors during compilation.

## Root Causes
1. Sequential processing of all rules (should be streaming/chunked)
2. N+1 database queries in validation
3. No timeout graceful degradation

## Solution
- Implement streaming compilation pipeline
- Batch rule validation
- Add progress tracking and resumable compilation

## Related
- #1728 - Timeout errors on large rulesets
""",
        }

    # For demo: Show what Claude would return
    errors = load_error_logs()
    analysis = analyze_errors_with_claude(errors)

    return mo.md(f"""
    ## 📊 Claude Analysis Results
    
    ### Root Causes
    {chr(10).join([f"- {cause}" for cause in analysis["root_causes"]])}
    
    ### Impact: {analysis["impact"]}
    
    ### Recommended Fixes
    {chr(10).join([f"- {fix}" for fix in analysis["fixes"]])}
    """)


@app.cell
def _pr_preview():
    """Show a preview of the PR that would be created."""
    import marimo as mo

    analysis = {
        "issue_title": "Implement streaming compilation for large rulesets (>50k rules)",
        "issue_body": """## Problem
Users with large custom filter lists experience timeout errors during compilation.

## Root Causes
1. Sequential processing of all rules (should be streaming/chunked)
2. N+1 database queries in validation
3. No timeout graceful degradation

## Solution
- Implement streaming compilation pipeline
- Batch rule validation
- Add progress tracking and resumable compilation

## Related
- #1728 - Timeout errors on large rulesets
""",
    }

    return mo.md(f"""
    ## 📝 Suggested GitHub Issue
    
    **Title:** {analysis["issue_title"]}
    
    ---
    
    {analysis["issue_body"]}
    
    ---
    
    ### Actions
    
    - [ ] **Create Issue** — Opens a new GitHub issue with the above content
    - [ ] **Create Draft PR** — Generates a draft PR that implements the fix
    - [ ] **Dismiss** — Skip this suggestion
    """)


@app.cell
def _create_pr_option():
    """Option to create a PR with the suggested fix."""
    import marimo as mo

    github_token = mo.ui.text(
        label="GitHub Token (for PR creation)",
        kind="password",
        placeholder="ghp_...",
        full_width=True,
    )

    create_issue_button = mo.ui.button(label="📌 Create GitHub Issue")
    create_pr_button = mo.ui.button(label="🔧 Create Draft PR")

    return mo.vstack(
        [
            mo.md("## 🚀 Create GitHub Issue & PR"),
            mo.md("*Requires GitHub token with repo write access*"),
            github_token,
            mo.hstack([create_issue_button, create_pr_button]),
            mo.md("""
        This will:
        1. Create a new GitHub issue with root cause analysis
        2. (Optional) Generate a draft PR with fix skeleton code
        3. Post a comment with marimo notebook link for reference
        
        **Once approved by human:**
        - Assign to team member
        - Review PR with standard CI checks
        - Merge when ready
        """),
        ]
    )


@app.cell
def _automation_tips():
    """Tips for automation."""
    return mo.md("""
    ## 💡 Automation Tips
    
    ### In Production
    
    Use **MCP tools** to trigger this analysis automatically:
    
    ```python
    # From worker/routes/compile.routes.ts:
    if (compilationFailed) {
      await fetch("https://marimo.bloqr.com/_mcp/execute", {
        method: "POST",
        headers: { "Authorization": `Bearer ${MCP_TOKEN}` },
        body: JSON.stringify({
          tool: "analyze_error",
          params: {
            error_id: "...",
            logs: errorLogs,
            auto_create_issue: true,  // Create issue without manual approval
          }
        })
      });
    }
    ```
    
    ### Scheduled Analysis
    
    Run this notebook on a cron schedule via **Cloudflare Workflows**:
    
    ```
    Cron: 0 * * * * (every hour)
    Action: POST https://marimo.bloqr.com/_mcp/execute
    Tool: analyze_recent_errors
    ```
    
    ### Alert Integration
    
    Connect to **PagerDuty** or **Slack**:
    
    ```python
    if analysis["impact"] == "High":
      slack.post_message(
        channel="#ops",
        text=f"🚨 {analysis['issue_title']}\\n{analysis['fixes'][0]}"
      )
    ```
    """)


@app.cell
def _footer():
    """Footer with resources."""
    return mo.md("""
    ---
    
    ## 📚 Learn More
    
    - [Marimo Docs: LLM Integration](https://docs.marimo.io/guides/configuration/llm_providers/)
    - [Anthropic API Reference](https://docs.anthropic.com/claude/reference/)
    - [Deployment Guide](../DEPLOYMENT.md)
    - [Error Dashboard](dashboard.py)
    """)
