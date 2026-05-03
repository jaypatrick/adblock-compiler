# Marimo Control Protocol (MCP) Integration Guide

## Overview

MCP enables marimo notebooks to execute commands, interact with external services, and participate in the automation pipeline:

```
Worker API → MCP Endpoint → Marimo Tools → Execute Fix → PR
```

This guide covers setting up MCP for:

- Error log analysis → PR generation
- Administrative operations (trigger compilation, clear cache)
- Integration with Cloudflare Workers and databases
- Distributed debugging and alerting

## Quick Setup

### 1. Enable MCP in `.marimo.toml`

```toml
[mcp]
enabled = true
# Authentication token for MCP requests
# Set via: export MCP_TOKEN="your-secure-token"
```

### 2. Define MCP Tools in a Runbook

```python
import marimo as mo
from marimo import mcp

# 1. Define MCP tools
@mcp.tool(description="Analyze error logs with Claude")
def analyze_error(
    error_id: str,
    logs: str,
    auto_create_issue: bool = False,
) -> dict:
    """
    Analyze error logs and optionally create a GitHub issue.
    
    Args:
        error_id: Unique error identifier
        logs: Error log content
        auto_create_issue: If True, create issue without approval
    
    Returns:
        {
            "status": "analyzed|issue_created|error",
            "root_causes": [...],
            "issue_url": "...",
        }
    """
    # 1. Analyze with Claude
    analysis = claude_analyze(logs)
    
    # 2. Create issue if requested
    if auto_create_issue:
        issue = github_create_issue(
            title=analysis.get("title"),
            body=analysis.get("body"),
        )
        return {
            "status": "issue_created",
            "issue_url": issue["url"],
            "analysis": analysis,
        }
    
    return {
        "status": "analyzed",
        "analysis": analysis,
    }


@mcp.tool(description="Trigger a compilation")
def trigger_compile(filters: str = "all") -> dict:
    """Trigger compilation via the Worker API."""
    resp = requests.post(
        "https://api.bloqr.dev/compile/trigger",
        json={"filters": filters},
        headers={"Authorization": f"Bearer {os.getenv('WORKER_API_KEY')}"},
    )
    return resp.json()


@mcp.tool(description="Clear compilation cache")
def clear_cache() -> dict:
    """Clear the D1/KV cache."""
    resp = requests.post(
        "https://api.bloqr.dev/cache/clear",
        headers={"Authorization": f"Bearer {os.getenv('WORKER_API_KEY')}"},
    )
    return resp.json()


# 2. Notebook UI to invoke tools manually
@mo.cell
def _invoke_tools():
    analyze_btn = mo.ui.button(label="🔍 Analyze")
    compile_btn = mo.ui.button(label="🔄 Compile")
    
    return mo.hstack([analyze_btn, compile_btn])
```

### 3. Call MCP from Cloudflare Worker

```typescript
// In worker/routes/compile.routes.ts
import { Router } from 'hono';

const compileRouter = new Router();

compileRouter.post('/trigger', async (c: Context<Env>) => {
    try {
        const { filters } = await c.req.json();

        // 1. Run compilation
        const result = await compileFilters(filters);

        // 2. If error, notify marimo MCP
        if (!result.success) {
            await notifyMcpError({
                error_id: result.error_id,
                logs: result.error_log,
                auto_create_issue: result.severity === 'high',
            });
        }

        return c.json(result);
    } catch (err) {
        // Notify MCP of unexpected error
        await notifyMcpError({
            error_id: crypto.randomUUID(),
            logs: JSON.stringify(err),
            auto_create_issue: false,
        });

        return c.json({ error: err.message }, 500);
    }
});

async function notifyMcpError(params: {
    error_id: string;
    logs: string;
    auto_create_issue: boolean;
}) {
    const mcp_token = c.env.MCP_TOKEN;
    const mcp_url = c.env.MCP_ENDPOINT || 'https://marimo.bloqr.com';

    try {
        const resp = await fetch(`${mcp_url}/_mcp/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mcp_token}`,
            },
            body: JSON.stringify({
                tool: 'analyze_error',
                params: {
                    error_id: params.error_id,
                    logs: params.logs,
                    auto_create_issue: params.auto_create_issue,
                },
            }),
        });

        if (!resp.ok) {
            console.error('MCP notify failed:', await resp.text());
        }
    } catch (err) {
        console.error('MCP request failed:', err);
        // Don't block compilation on MCP error
    }
}
```

## MCP Endpoint Reference

### List Available Tools

**Request:**

```bash
curl -X POST https://marimo.bloqr.com/_mcp/tools \
  -H "Authorization: Bearer $MCP_TOKEN"
```

**Response:**

```json
{
    "tools": [
        {
            "name": "analyze_error",
            "description": "Analyze error logs with Claude",
            "parameters": {
                "error_id": "string",
                "logs": "string",
                "auto_create_issue": "boolean"
            }
        },
        {
            "name": "trigger_compile",
            "description": "Trigger a compilation",
            "parameters": {
                "filters": "string"
            }
        }
    ]
}
```

### Execute a Tool

**Request:**

```bash
curl -X POST https://marimo.bloqr.com/_mcp/execute \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "analyze_error",
    "params": {
      "error_id": "err-123",
      "logs": "Error: Timeout in compilation pipeline",
      "auto_create_issue": true
    }
  }'
```

**Response:**

```json
{
    "status": "issue_created",
    "issue_url": "https://github.com/jaypatrick/adblock-compiler/issues/1234",
    "analysis": {
        "root_causes": ["Timeout in large ruleset processing"],
        "fixes": ["Implement streaming compilation"]
    }
}
```

## Errors → MCP → Analysis → PR Pipeline

### 1. Detect Error in Worker

```typescript
// Error occurs during compilation
const compiledRules = await compileFilters(userFilters);
if (!compiledRules.ok) {
  // Error detected!
  await notifyMcpError({...});
}
```

### 2. MCP Receives Error

Marimo receives the error via POST `/_mcp/execute` with `analyze_error` tool.

### 3. Analyze with Claude

```python
def analyze_error(error_id: str, logs: str, auto_create_issue: bool) -> dict:
    # 1. Send to Claude
    response = claude.messages.create(
        model="claude-sonnet-4-6",
        messages=[
            {
                "role": "user",
                "content": f"""Analyze this error:
                
{logs}

Provide:
1. Root cause
2. Impact (High/Med/Low)
3. Recommended fix
4. GitHub issue title and body
"""
            }
        ]
    )
    
    # 2. Parse Claude's analysis
    analysis = parse_analysis(response.content[0].text)
    
    # 3. Optionally create GitHub issue
    if auto_create_issue:
        issue = create_github_issue(
            title=analysis["issue_title"],
            body=analysis["issue_body"],
            labels=["bug", f"severity-{analysis['impact'].lower()}"],
        )
        return {
            "status": "issue_created",
            "issue_url": issue.html_url,
            "analysis": analysis,
        }
    
    return {"status": "analyzed", "analysis": analysis}
```

### 4. Create PR (Optional)

If the fix is simple, create a draft PR:

```python
@mcp.tool(description="Create draft PR with fix")
def create_pr_for_error(issue_url: str) -> dict:
    """
    Given a GitHub issue, generate a draft PR with the fix.
    """
    # 1. Fetch issue details
    issue = github.get_issue(issue_url)
    
    # 2. Ask Claude to generate fix code
    fix_code = claude_generate_fix(issue.body)
    
    # 3. Create PR
    pr = github.create_pull_request(
        title=f"Fix: {issue.title}",
        body=f"Fixes {issue_url}\n\n{fix_code}",
        head=f"fix/{issue.number}",
        base="main",
        draft=True,
    )
    
    return {"pr_url": pr.html_url}
```

## Scheduled Error Analysis

### Via Cloudflare Workflows

Create a workflow that runs every hour:

```typescript
// worker/workflows/error-analysis-schedule.ts
import { WorkflowEntrypoint } from 'cloudflare:workflows';

export class ErrorAnalysisWorkflow extends WorkflowEntrypoint {
    async run(event, step) {
        // 1. Fetch recent errors
        const recentErrors = await step.do('fetch-errors', async () => {
            return await getRecentErrors(1); // last 1 hour
        });

        // 2. For each error, trigger MCP analysis
        for (const error of recentErrors) {
            await step.do(`analyze-${error.id}`, async () => {
                return await notifyMcpError({
                    error_id: error.id,
                    logs: error.message,
                    auto_create_issue: error.severity === 'high',
                });
            });
        }
    }
}
```

Then trigger from your Worker:

```typescript
// Schedule the workflow
const workflow = env.WORKFLOWS.create({
    workflow: 'ErrorAnalysisWorkflow',
    trigger: { cron: '0 * * * *' }, // Every hour
});
```

## Authentication & Security

### Token-Based Auth

1. **Generate token:**
   ```bash
   # In marimo server setup
   export MCP_TOKEN="$(openssl rand -hex 32)"
   ```

2. **Store securely:**
   - **Worker:** `env.MCP_TOKEN` (Cloudflare Secret)
   - **Database:** Hashed token in MCP_TOKENS table

3. **Validate on each request:**
   ```python
   # In marimo MCP middleware
   def validate_mcp_request(request):
       token = request.headers.get("Authorization", "").replace("Bearer ", "")
       if not token or token != os.getenv("MCP_TOKEN"):
           raise PermissionError("Invalid MCP token")
   ```

### Rate Limiting

```python
from functools import wraps
from time import time

mcp_rate_limit = {}

def rate_limit_mcp(max_calls: int = 10, window: int = 60):
    """Rate limit MCP tool execution."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            client_id = kwargs.get("client_id", "unknown")
            now = time()
            
            if client_id not in mcp_rate_limit:
                mcp_rate_limit[client_id] = []
            
            # Clean old entries
            mcp_rate_limit[client_id] = [
                t for t in mcp_rate_limit[client_id] if now - t < window
            ]
            
            if len(mcp_rate_limit[client_id]) >= max_calls:
                raise RateLimitError(f"Too many requests for {client_id}")
            
            mcp_rate_limit[client_id].append(now)
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator
```

## Troubleshooting

### MCP Endpoint Not Responding

```bash
# Test connectivity
curl -I https://marimo.bloqr.com/_mcp/tools

# Check marimo server logs
journalctl -u marimo -f
```

### Token Invalid

```bash
# Verify token in Worker
wrangler tail --format json | grep MCP_TOKEN
```

### Tool Execution Timeout

Increase execution timeout in `.marimo.toml`:

```toml
[server]
execution_timeout = 300  # 5 minutes
```

## Next Steps

1. **Implement error detection** in worker routes
2. **Deploy marimo server** behind Cloudflare Tunnel
3. **Configure MCP_TOKEN** in Worker Secrets
4. **Create custom MCP tools** for your use case (triggers, deployments, etc.)
5. **Set up alerts** to Slack/PagerDuty when high-severity errors are analyzed

## References

- [Marimo MCP Documentation](https://docs.marimo.io/guides/editor_features/mcp/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/)
- [GitHub API](https://docs.github.com/en/rest)
