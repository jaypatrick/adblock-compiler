# Marimo Deployment Guide

This guide covers deploying marimo runbooks for Bloqr with secure access, theming, LLM integration, and MCP support.

## Quick Start

For local development:

```bash
# One-time setup
uv sync --directory tools

# Launch the master pipeline
uv run --directory tools marimo run runbooks/pipeline.py

# Launch a specific runbook
uv run --directory tools marimo run runbooks/dashboard.py
```

Or use Deno shortcuts:

```bash
deno task runbook:setup       # Install marimo + dependencies
deno task runbook:pipeline    # Open master pipeline
deno task runbook:dashboard   # Open stats dashboard
```

## Production Deployment: Cloudflare Tunnel + CF Access

### Architecture

```
┌─────────────────────┐
│   Users / Teams     │
└──────────┬──────────┘
           │ (HTTPS)
           ↓
┌─────────────────────────────────────┐
│   Cloudflare Edge (CF Access)       │
│   - SSO verification                │
│   - Per-user policy enforcement     │
│   - Audit logging                   │
└──────────┬──────────────────────────┘
           │ (Tunnel)
           ↓
┌─────────────────────────────────────┐
│   Marimo Server                     │
│   - SSH key auth (optional)         │
│   - Full LSP / AI / command exec    │
│   - Reactive notebooks              │
└─────────────────────────────────────┘
```

**Benefits:**

- Zero-trust network — requires Cloudflare Access identity proof
- Global distributed cache and DDoS protection
- Per-notebook or per-user access policies
- Audit trail in Cloudflare Analytics
- No firewall rules needed

### Setup Steps

#### 1. Create Cloudflare Tunnel

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Authenticate
cloudflared tunnel login

# Create tunnel (once)
cloudflared tunnel create bloqr-marimo

# Get tunnel ID (for wrangler.toml)
cloudflared tunnel list
```

#### 2. Configure Tunnel (`.cloudflared/config.yml`)

```yaml
tunnel: bloqr-marimo
credentials-file: /path/to/.cloudflared/<TUNNEL_ID>.json

ingress:
    - hostname: marimo.bloqr.com
      service: http://localhost:2718
    - service: http_status:404
```

#### 3. Start the Tunnel

```bash
cloudflared tunnel run bloqr-marimo
```

#### 4. Set Up CF Access (Identity)

In Cloudflare Dashboard → Zero Trust → Access → Applications:

1. **Create an Access Application** for `marimo.bloqr.com`
   - Set to "Self-hosted"
   - Add required policies (e.g., "Allow emails ending in @bloqr.dev")
   - Require multi-factor authentication if needed

2. **Test Access**
   - Navigate to `https://marimo.bloqr.com`
   - You'll be prompted to authenticate via Cloudflare Access
   - Approval logs appear in Analytics

#### 5. Enable SSH Key Auth (Optional for CI/CD)

If you want to run runbooks from CI pipelines:

```bash
# Generate SSH key for marimo server
ssh-keygen -t ed25519 -f ~/.ssh/marimo-ci

# Configure CF Access to allow SSH key auth
# (documented in CF Zero Trust SSH guide)
```

### Marimo Server Configuration

To run marimo as a persistent server (not just `marimo run`):

```bash
# Start server (binds to 127.0.0.1:2718 behind tunnel)
marimo server \
  --port 2718 \
  --host 127.0.0.1 \
  --no-browser

# Behind systemd (production):
# Create /etc/systemd/system/marimo.service
```

**SystemD Service Example:**

```ini
[Unit]
Description=Marimo Ops Runbooks Server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/bloqr/adblock-compiler
ExecStart=/usr/local/bin/uv run --directory tools marimo server --port 2718 --host 127.0.0.1 --no-browser
Restart=on-failure
RestartSec=10
User=marimo
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Environment Variables

Set these before running marimo:

```bash
# LLM integration
export ANTHROPIC_API_KEY="sk-ant-..."          # Copilot / Claude access

# Marimo telemetry & analytics (optional)
export MARIMO_ANALYTICS_ENABLED="false"        # Disable if desired

# Notebook configuration
export MARIMO_DIR="/opt/bloqr/runbooks"        # Notebook location
export MARIMO_NOTEBOOK_URL="https://marimo.bloqr.com"  # Public URL
```

## Theming & Design

Bloqr notebooks use a custom design language with dark/light themes, animations, and branded components.

### Custom CSS

See `theming/bloqr-theme.css` for:

- Color palette (primary, accent, neutral)
- Typography (fonts, sizes, weights)
- Component styling (cards, buttons, stats)
- Animations and transitions
- Dark mode variables

### Using Themes in Notebooks

```python
import marimo as mo

# In your runbook:
mo.css("""
/* Bloqr theme */
:root {
  --bloqr-primary: #2563eb;
  --bloqr-success: #10b981;
  --bloqr-warning: #f59e0b;
  --bloqr-danger: #ef4444;
}
""")
```

## LLM Integration & Automation

### Logs → Analysis → PR/Repair

Marimo runs Python directly, so you can:

1. **Fetch logs** from Cloudflare Workers, databases, or files
2. **Analyze with LLM** using Claude AI
3. **Generate fixes** as PRs or shell commands
4. **Execute & validate** directly in the notebook

**Example flow:**

```python
import marimo as mo
from anthropic import Anthropic

# 1. Load logs
logs = load_error_logs("last_24h")

# 2. Ask Claude to analyze
response = claude.messages.create(
    model="claude-sonnet-4-6",
    messages=[
        {"role": "user", "content": f"Analyze these error logs:\n{logs}"}
    ]
)

# 3. Display analysis
mo.md(response.content[0].text)

# 4. Generate fix (as markdown code block)
# User can copy/run the generated solution
```

See `runbooks/error-analysis.py` for a full example.

## MCP (Marimo Control Protocol)

### Overview

MCP enables:

- Marimo ↔ External tools communication
- Direct execution of shell/SQL/Python from marimo
- Logs → Marimo → LLM → PR/fix pipeline
- Distributed debugging and alerting

### Setting Up MCP Server

In your runbook:

```python
import marimo as mo
from marimo import mcp

# Define MCP tools
@mcp.tool(description="Get compile stats")
def get_compile_stats():
    return {"compiled": 1234, "errors": 0}

@mcp.tool(description="Trigger a compilation")
def trigger_compile(filters: str):
    # Execute compilation logic
    return {"status": "started", "job_id": "abc123"}

# MCP endpoints available:
# POST /_mcp/tools → list available tools
# POST /_mcp/execute → execute a tool
```

### Integration with Cloudflare Workers

Send errors/events from your Worker to marimo MCP:

```typescript
// In worker/routes/compile.routes.ts
if (error) {
    const mcp_url = `https://marimo.bloqr.com/_mcp/execute`;
    await fetch(mcp_url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${MCP_TOKEN}` },
        body: JSON.stringify({
            tool: 'log_error',
            params: { error, context: 'compilation' },
        }),
    }).catch((err) => console.error('MCP log failed', err));
}
```

## Public Gallery Submission

### Creating a Gallery-Ready Notebook

1. **Rich UI** — Use sliders, buttons, charts, animations
2. **Dark/Light theme** — Embeds custom CSS for both modes
3. **OpenGraph metadata** — Title, description, thumbnail

Example structure:

```python
import marimo as mo

app = mo.App(
    title="Bloqr Compile Stats Dashboard",
    description="Real-time compilation metrics and performance analytics"
)

@app.cell
def _header(mo):
    return mo.md("""
    # 📊 Bloqr Compile Stats

    **Last 24h:** 15,234 compilations, 2 errors, 99.98% success
    """)

@app.cell
def _chart(mo):
    # Interactive chart with marimo reactive state
    return mo.ui.slider(label="Hours", value=24, min=1, max=168)

# ... more cells
```

### Publish to Gallery

```bash
# Export notebook as WASM (for public gallery)
marimo export html --wasm runbooks/dashboard.py > dashboard.html

# Submit to https://marimo.io/gallery
# (link, description, screenshot)
```

## Troubleshooting

### Port already in use

```bash
lsof -i :2718
# Kill the process or choose a different port
```

### CloudFlare Tunnel not routing

```bash
# Test tunnel connectivity
curl -I https://marimo.bloqr.com

# Check cloudflared logs
journalctl -u cloudflared -f
```

### LLM requests failing

```bash
# Verify API key
echo $ANTHROPIC_API_KEY

# Test Claude API
uv run python3 -c "from anthropic import Anthropic; print(Anthropic().messages.create(model='claude-haiku-4-5', max_tokens=100, messages=[{'role': 'user', 'content': 'Hello'}]))"
```

### Marimo won't load

```bash
# Check for syntax errors in notebook
deno run --allow-read tools/.marimo.toml

# Verify uv environment
uv sync --directory tools

# Try reloading browser (Cmd+Shift+R on macOS)
```

## References

- [Marimo documentation](https://docs.marimo.io)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Cloudflare Access docs](https://developers.cloudflare.com/cloudflare-one/access/)
- [Anthropic Claude API](https://www.anthropic.com/api)
- [Marimo MCP Guide](https://docs.marimo.io/guides/editor_features/mcp/)
