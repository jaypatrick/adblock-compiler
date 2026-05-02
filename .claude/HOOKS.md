# Marimo Claude Code Hooks

This directory contains hooks for integrating Claude Code with Marimo notebooks in the adblock-compiler project. Hooks automatically run after Claude Code performs `Edit` or `Write` operations to validate and lint code.

## Configuration

**File:** `.claude/settings.json`

The configuration file defines hooks that execute after Claude Code operations:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/hooks/marimo-check.sh"
          },
          {
            "type": "command",
            "command": "./.claude/hooks/project-lint.sh"
          }
        ]
      }
    ]
  }
}
```

## Available Hooks

### 1. `marimo-check.sh`

**Purpose:** Validates Marimo notebooks using `marimo check`

**Behavior:**
- Detects if a file is a Marimo notebook (looks for `import marimo` and `@app.cell`)
- Runs `marimo check` via `uvx` to validate notebook structure
- **Blocks execution** (exit code 2) if check fails — informs Claude to fix issues
- **Reports success** (exit code 0) if check passes

**Files Checked:**
- Any Python file with Marimo imports in `tools/` directory

**Example Error Handling:**
```
✗ Marimo check failed for tools/my_notebook.py
  Error: Cell dependency validation failed
  
Please fix the marimo notebook issues shown above.
```

### 2. `project-lint.sh`

**Purpose:** Enforces project-specific formatting and linting rules

**Behavior:**
- **TypeScript files** (`src/`, `worker/`): Runs `deno fmt` and `deno lint`
- **Python files** (`tools/`): Runs `ruff check` and `ruff format`
- Provides **informative warnings** (non-blocking) for style issues
- Auto-fixes some formatting issues with `deno fmt`

**Files Checked:**
- TypeScript: `src/**/*.ts(x)` and `worker/**/*.ts(x)`
- Python: `tools/**/*.py`

**Example Warnings:**
```
🔍 Checking TypeScript formatting for src/compiler/index.ts...
⚠️  Lint warnings found. Review with: deno task lint
```

## How It Works

1. **Claude writes or edits code** using the Edit/Write tools
2. **Post-operation triggers** - Hooks automatically run on the changed file
3. **Hook 1 (Marimo Check)** - If it's a Marimo notebook, validates it
   - ✅ Pass → Proceeds to next hook
   - ✗ Fail → Tells Claude to fix issues
4. **Hook 2 (Project Lint)** - Runs project-specific linting
   - Checks formatting and style rules
   - Reports issues (non-blocking)

## Manual Hook Execution

Run hooks manually for testing:

```bash
# Test marimo-check on a notebook
./.claude/hooks/marimo-check.sh <<< '{"tool_response": {"filePath": "tools/my_notebook.py"}}'

# Test project-lint on a file
./.claude/hooks/project-lint.sh <<< '{"tool_response": {"filePath": "src/index.ts"}}'
```

## Hook Input Format

Hooks receive JSON on stdin from Claude Code:

```json
{
  "tool_response": {
    "filePath": "/absolute/path/to/file.ts",
    ...other fields...
  }
}
```

## Exit Codes

- **0** - Success, no issues
- **1** - General error (still passes to Claude)
- **2** - Critical error (blocks, tells Claude to fix)

Only exit code **2** is blocking and will inform Claude to fix the issues.

## Requirements

### Marimo Hook
- `uvx` (Uv toolchain) installed
- `marimo` available via `uvx marimo`
- `jq` for JSON parsing

### Project Lint Hook
- `deno` for TypeScript linting/formatting
- `uv` for Python linting (in `tools/` directory)
- `ruff` for Python checking

## Extending the Hooks

To add more validation:

1. **Modify `.claude/settings.json`** to add new command entries
2. **Create new `.claude/hooks/*.sh`** script
3. **Make it executable:** `chmod +x .claude/hooks/myhook.sh`

Example new hook:

```json
{
  "type": "command",
  "command": "./.claude/hooks/security-check.sh"
}
```

## Troubleshooting

**Hook not running?**
- Verify scripts are executable: `ls -la .claude/hooks/`
- Check `.claude/settings.json` syntax (valid JSON)
- Ensure file paths in commands are correct

**False positives from marimo-check?**
- Not all Python files with `import marimo` are notebooks
- Add more strict detection if needed

**Linting errors seem wrong?**
- Verify you're using the correct lint tool for the file type
- Check project linting configs: `deno.json`, `pyproject.toml`

## References

- [Marimo Hooks Documentation](https://docs.marimo.io/guides/generate_with_ai/using_claude_code/#hooks)
- [Deno Formatting & Linting](https://docs.deno.com/runtime/fundamentals/configuration/)
- [Ruff Python Linter](https://docs.astral.sh/ruff/)
