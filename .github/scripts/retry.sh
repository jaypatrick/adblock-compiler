# retry_command <max_attempts> <initial_delay_seconds> <command> [args...]
#
# Retries a command up to max_attempts times with exponential backoff.
# Returns 0 on success, 1 if all attempts fail.
#
# Usage:
#   source .github/scripts/retry.sh
#   retry_command 3 15 some-command --flag value
retry_command() {
    if [[ -z "${BASH_VERSION:-}" ]]; then
        echo "retry_command: requires bash (BASH_VERSION unset)" >&2
        return 2
    fi
    if (($# < 3)); then
        echo "Usage: retry_command <max_attempts> <initial_delay_seconds> <command> [args...]" >&2
        return 2
    fi
    local max=$1 delay=$2 attempt=1; shift 2
    until "$@"; do
        (( attempt++ ))
        if (( attempt > max )); then
            echo "All $max attempts failed." >&2
            return 1
        fi
        echo "Attempt $(( attempt - 1 ))/$max failed. Retrying in ${delay}s..." >&2
        sleep "$delay"
        delay=$(( delay * 2 ))
    done
}
