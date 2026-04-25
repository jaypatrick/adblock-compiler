/**
 * HTML escape utility.
 *
 * Escapes the five characters that are significant in HTML
 * (`&`, `<`, `>`, `"`, `'`) to their HTML entity equivalents.
 *
 * Use whenever user-supplied strings are interpolated into HTML
 * to prevent XSS vulnerabilities.
 *
 * @param str - Raw string that may contain HTML-special characters.
 * @returns   HTML-safe string safe for interpolation into HTML content.
 *
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
export function escapeHtml(str: string): string {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
