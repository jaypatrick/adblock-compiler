# Postman API Testing Guide

This guide explains how to use the Postman collection to test the Adblock Compiler OpenAPI endpoints.

## Quick Start

### 1. Import the Collection

1. Open Postman
2. Click **Import** in the top left
3. Select **File** and choose `docs/postman/postman-collection.json`
4. The collection will appear in your workspace

### 2. Import the Environment

For **local development**:

1. Click **Import** again
2. Select **File** and choose `docs/postman/postman-environment-local.json`
3. Select the **Adblock Compiler API - Local** environment from the dropdown in the top right

For **production testing**:

1. Click **Import** again
2. Select **File** and choose `docs/postman/postman-environment-prod.json`
3. Select the **Adblock Compiler API - Prod** environment from the dropdown
4. Populate the secret variables via Postman Vault — see [Credentials](#credentials) below

### 3. Start the Server

```bash
# Start local development server
deno task dev

# Or using Docker
docker compose up -d
```

The server will be available at `http://localhost:8787`

### 4. Run Tests

You can run tests individually or as a collection:

- **Individual Request**: Click any request and press **Send**
- **Folder**: Right-click a folder and select **Run folder**
- **Entire Collection**: Click the **Run** button next to the collection name

## Collection Structure

The collection is organized into the following folders:

### 📊 Metrics
- **Get API Info** - Retrieves API version and available endpoints
- **Get Performance Metrics** - Fetches aggregated performance data

### ⚙️ Compilation
- **Compile Simple Filter List** - Basic compilation with pre-fetched content
- **Compile with Transformations** - Tests multiple transformations (RemoveComments, Validate, Deduplicate)
- **Compile with Cache Check** - Verifies caching behavior (X-Cache header)
- **Compile Invalid Configuration** - Error handling test

### 📡 Streaming
- **Compile with SSE Stream** - Server-Sent Events streaming test

### 📦 Batch Processing
- **Batch Compile Multiple Lists** - Compile 2 lists in parallel
- **Batch Compile - Max Limit Test** - Test the 10-item batch limit

### 🔄 Queue
- **Queue Async Compilation** - Queue a job for async processing
- **Queue Batch Async Compilation** - Queue multiple jobs
- **Get Queue Stats** - Retrieve queue metrics
- **Get Queue Results** - Fetch results using requestId

### 🔍 Edge Cases
- **Empty Configuration** - Test with empty request body
- **Missing Required Fields** - Test validation
- **Large Batch Request (>10)** - Test batch size limit enforcement

## Test Assertions

Each request includes automated tests that verify:

### Response Validation
```javascript
pm.test('Status code is 200', function () {
    pm.response.to.have.status(200);
});
```

### Schema Validation
```javascript
pm.test('Response is successful', function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData).to.have.property('rules');
});
```

### Business Logic
```javascript
pm.test('Rules are deduplicated', function () {
    const jsonData = pm.response.json();
    const uniqueRules = new Set(jsonData.rules.filter(r => !r.startsWith('!')));
    pm.expect(uniqueRules.size).to.equal(jsonData.rules.filter(r => !r.startsWith('!')).length);
});
```

### Header Validation
```javascript
pm.test('Check cache headers', function () {
    pm.expect(pm.response.headers.get('X-Cache')).to.be.oneOf(['HIT', 'MISS']);
});
```

## Variables

### Local environment (`postman-environment-local.json`)

- **`baseUrl`** — Local development server URL (`http://localhost:8787`)
- **`requestId`** — Auto-populated from async compilation responses
- **`userId`** — Captured from Create User response
- **`apiKeyPrefix`** — Captured from Create API Key response

### Prod environment (`postman-environment-prod.json`)

- **`baseUrl`** — Production URL (`https://api.bloqr.dev`)
- **`bearerToken`** — Better Auth JWT or API key (secret, empty by default)
- **`userApiKey`** — User API key with `abc_` prefix (secret, empty by default)
- **`adminKey`** — Admin API key (secret, empty by default)
- **`requestId`**, **`userId`**, **`apiKeyPrefix`** — Same as local

### Switching Between Environments

Use the **environment dropdown** in the top-right corner of Postman to switch between **Local** and **Prod**. Each environment sets `baseUrl` to the correct host — no variable editing needed.

## Credentials

Secret variables in the Prod environment (`bearerToken`, `userApiKey`, `adminKey`) are empty by default and must be populated at runtime. See [docs/postman/README.md — Prod Environment & Credentials](../postman/README.md#prod-environment--credentials) for full Postman Vault and Newman setup instructions.

**Summary for desktop:**

1. Open **Settings → Vault** in Postman Desktop
2. Add `POSTMAN_BEARER_TOKEN`, `POSTMAN_USER_API_KEY`, `POSTMAN_ADMIN_KEY`
3. In the Prod environment, set each variable's **Current Value** to `{{vault:POSTMAN_BEARER_TOKEN}}` etc.

**Summary for Newman:**

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --env-var "bearerToken=$POSTMAN_BEARER_TOKEN" \
  --env-var "userApiKey=$POSTMAN_USER_API_KEY" \
  --env-var "adminKey=$POSTMAN_ADMIN_KEY"
```

## Running Collection with Newman (CLI)

```bash
# Install Newman
npm install -g newman

# Run against local server (no credentials needed)
newman run docs/postman/postman-collection.json -e docs/postman/postman-environment-local.json

# Run with detailed output (local)
newman run docs/postman/postman-collection.json -e docs/postman/postman-environment-local.json --reporters cli,json

# Run against production (inject credentials at runtime)
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --env-var "bearerToken=$POSTMAN_BEARER_TOKEN" \
  --env-var "userApiKey=$POSTMAN_USER_API_KEY" \
  --env-var "adminKey=$POSTMAN_ADMIN_KEY"

# Run specific folder
newman run docs/postman/postman-collection.json -e docs/postman/postman-environment-local.json --folder "Compilation"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: API Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start server
        run: docker compose up -d
      
      - name: Wait for server
        run: sleep 5
      
      - name: Install Newman
        run: npm install -g newman
      
      - name: Run Postman tests (local)
        run: newman run docs/postman/postman-collection.json -e docs/postman/postman-environment-local.json
      
      - name: Stop server
        run: docker compose down
```

For production smoke tests in CI, inject credentials from GitHub Actions secrets:

```yaml
      - name: Run Postman tests (prod)
        env:
          POSTMAN_BEARER_TOKEN: ${{ secrets.POSTMAN_BEARER_TOKEN }}
          POSTMAN_USER_API_KEY: ${{ secrets.POSTMAN_USER_API_KEY }}
          POSTMAN_ADMIN_KEY: ${{ secrets.POSTMAN_ADMIN_KEY }}
        run: |
          newman run docs/postman/postman-collection.json \
            -e docs/postman/postman-environment-prod.json \
            --env-var "bearerToken=$POSTMAN_BEARER_TOKEN" \
            --env-var "userApiKey=$POSTMAN_USER_API_KEY" \
            --env-var "adminKey=$POSTMAN_ADMIN_KEY"
```

## Advanced Testing

### Pre-request Scripts

You can add pre-request scripts to generate dynamic data:

```javascript
// Generate random filter rules
const rules = Array.from({length: 10}, (_, i) => `||example${i}.com^`);
pm.collectionVariables.set('dynamicRules', rules.join('\\n'));
```

### Test Sequences

Run requests in sequence to test workflows:

1. Queue Async Compilation → captures `requestId`
2. Get Queue Stats → verify job is pending
3. Get Queue Results → retrieve compiled results

### Performance Testing

Use the Collection Runner with multiple iterations:

1. Click **Run** on the collection
2. Set **Iterations** to desired number (e.g., 100)
3. Set **Delay** between requests (e.g., 100ms)
4. View performance metrics in the run summary

## Troubleshooting

### Server Not Responding

```bash
# Check if server is running
curl http://localhost:8787/api

# Check Docker logs
docker compose logs -f

# Restart server
docker compose restart
```

### Queue Tests Failing

Queue tests may return 500 if Cloudflare Queues aren't configured:

```json
{
  "success": false,
  "error": "Queue bindings are not available..."
}
```

This is expected for local development without queue configuration.

### Rate Limiting

If you hit rate limits (429 responses), wait for the rate limit window to reset or adjust `RATE_LIMIT_MAX_REQUESTS` in the server configuration.

## Best Practices

1. **Run tests before commits** - Ensure API compatibility
2. **Test against local first** - Avoid production impact
3. **Use environments** - Switch via the environment dropdown (Local vs. Prod)
4. **Review test results** - Don't ignore failed assertions
5. **Update tests** - Keep tests in sync with OpenAPI spec changes

## Related Documentation

- [OpenAPI Specification](../api/openapi.yaml)
- [API Documentation](../api/README.md)
- [Queue Support](../cloudflare/QUEUE_SUPPORT.md)
- [WebSocket Documentation](../../worker/websocket.ts)

## Support

For issues or questions:
- Check the [main README](../../README.md)
- Review the [OpenAPI spec](../api/openapi.yaml)
- Open an issue on GitHub
