#!/bin/bash

# Project-specific linting hook for adblock-compiler
# Validates TypeScript, Python, and formatting

# Require jq — fail loudly so developers know to install it rather than silently skipping validation
if ! command -v jq &> /dev/null; then
    echo "✗ project-lint.sh requires jq (https://jqlang.org) but it is not installed." >&2
    echo "  Install it and re-run, or this hook will never validate files." >&2
    exit 1
fi

# Read stdin (contains JSON with tool result)
INPUT=$(cat)

# Extract file path from JSON using jq
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_response.filePath // empty')

# If no file path found, exit silently
if [ -z "$FILE_PATH" ] || [ "$FILE_PATH" = "null" ]; then
    exit 0
fi

# Check if file exists
if [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

# Get file extension
FILE_EXT="${FILE_PATH##*.}"

# Resolve repo root so we can match absolute paths correctly
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# TypeScript/JavaScript files in src/ or worker/ (match absolute paths)
if [[ "$FILE_PATH" == "$REPO_ROOT/src/"* ]] || [[ "$FILE_PATH" == "$REPO_ROOT/worker/"* ]]; then
    if [[ "$FILE_EXT" == "ts" ]] || [[ "$FILE_EXT" == "tsx" ]]; then
        echo "🔍 Checking TypeScript formatting for $FILE_PATH..."
        
        # Run deno fmt check (non-blocking, informative only — do NOT auto-rewrite)
        if ! deno fmt --check "$FILE_PATH" 2>/dev/null; then
            echo "⚠️  File needs formatting. Run: deno task fmt" >&2
        fi
        
        # Run deno lint (informative only)
        if deno lint "$FILE_PATH" 2>/dev/null | grep -q .; then
            echo "⚠️  Lint warnings found. Review with: deno task lint" >&2
        fi
    fi
fi

# Python files in tools/ (match absolute paths)
if [[ "$FILE_PATH" == "$REPO_ROOT/tools/"* ]]; then
    if [[ "$FILE_EXT" == "py" ]]; then
        echo "🔍 Checking Python code for $FILE_PATH..."
        
        # Run ruff check (non-blocking)
        if ! command -v uv &> /dev/null; then
            echo "⚠️  uv is not installed — Python validation skipped for $FILE_PATH" >&2
            echo "   Install uv (https://docs.astral.sh/uv/getting-started/installation/) and run: uv sync --directory tools" >&2
        else
            if ! uv run --directory tools ruff check "$FILE_PATH" 2>/dev/null; then
                echo "⚠️  Ruff issues found. Run: uv run --directory tools ruff check $FILE_PATH" >&2
            fi
            
            # Check formatting
            if ! uv run --directory tools ruff format --check "$FILE_PATH" 2>/dev/null; then
                echo "⚠️  Python file needs formatting. Run: uv run --directory tools ruff format $FILE_PATH" >&2
            fi
        fi
    fi
fi

exit 0
