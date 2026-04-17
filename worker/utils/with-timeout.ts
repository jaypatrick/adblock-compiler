/**
 * Race an async operation against a timeout.
 *
 * Returns the operation result when it resolves first, or `void` when timeout
 * wins. The timeout timer is cleared when the wrapped promise settles first.
 * If timeout wins, the wrapped operation continues in the background unless the
 * caller provides its own cancellation mechanism (for example AbortSignal).
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<void | T> {
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
    });
    return Promise.race([
        promise.finally(() => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        }),
        timeoutPromise,
    ]);
}
