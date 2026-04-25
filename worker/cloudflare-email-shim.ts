// Type shim for the cloudflare:email ESM module.
// Provides a stub EmailMessage class so Deno's type-checker and test runner
// can resolve imports from 'cloudflare:email'. At runtime on Cloudflare Workers
// the actual module is used; this shim is only loaded in Deno environments.

/**
 * Stub implementation of the Cloudflare Workers `EmailMessage` class.
 *
 * The real `EmailMessage` (from the `cloudflare:email` Workers runtime module)
 * accepts a raw MIME string or ReadableStream and is passed directly to a
 * `SendEmail` binding's `.send()` method for delivery via Cloudflare Email
 * Routing. This stub satisfies Deno's import resolver without pulling in the
 * Workers-only native module.
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
 */
export class EmailMessage {
    /** Sender address (RFC 5321 envelope from). */
    readonly from: string;
    /** Recipient address (RFC 5321 envelope to). */
    readonly to: string;
    /** Raw MIME message (RFC 2822 / RFC 5322) or a ReadableStream yielding it. */
    readonly raw: ReadableStream | string;

    /**
     * @param from - Envelope sender address (e.g. `"notifications@bloqr.dev"`).
     * @param to   - Envelope recipient address.
     * @param raw  - Full RFC 5322 MIME message string or a ReadableStream of one.
     */
    constructor(from: string, to: string, raw: ReadableStream | string) {
        this.from = from;
        this.to = to;
        this.raw = raw;
    }
}
