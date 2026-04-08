/**
 * JsonHighlightPipe — CSS-class-based syntax highlighting for JSON and YAML.
 *
 * Wraps JSON/YAML tokens in `<span>` elements with semantic CSS classes so
 * that the preview pane can apply theme colours without adding heavy
 * third-party dependencies.
 *
 * Content is always machine-generated configuration data (never arbitrary user
 * HTML), so using `bypassSecurityTrustHtml` is safe here.
 *
 * @see config-builder.component.scss — colour definitions for .json-* and .yaml-* classes
 */

import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'jsonHighlight', standalone: true, pure: true })
export class JsonHighlightPipe implements PipeTransform {
    private readonly sanitizer = inject(DomSanitizer);

    transform(value: string | null | undefined, format: 'json' | 'yaml' = 'json'): SafeHtml {
        if (!value) return this.sanitizer.bypassSecurityTrustHtml('');
        const highlighted = format === 'yaml' ? this.highlightYaml(value) : this.highlightJson(value);
        return this.sanitizer.bypassSecurityTrustHtml(highlighted);
    }

    // -------------------------------------------------------------------------
    // JSON highlighting
    // -------------------------------------------------------------------------

    private highlightJson(json: string): string {
        // Escape HTML entities first so injected spans are not double-processed
        const escaped = this.escapeHtml(json);

        return escaped.replace(
            // Match: key strings, string values, numbers, booleans, nulls
            /(&quot;((?:\\.|[^\\&])*)&quot;\s*:)|(&quot;((?:\\.|[^\\&])*)&quot;)|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
            (match) => {
                // Key (ends with colon)
                if (/^&quot;.*&quot;\s*:/.test(match)) {
                    const colon = match.lastIndexOf(':');
                    const keyPart = match.slice(0, colon);
                    return `<span class="json-key">${keyPart}</span>:`;
                }
                // String value
                if (/^&quot;/.test(match)) {
                    return `<span class="json-string">${match}</span>`;
                }
                // Number
                if (/^-?\d/.test(match)) {
                    return `<span class="json-number">${match}</span>`;
                }
                // Boolean
                if (match === 'true' || match === 'false') {
                    return `<span class="json-bool">${match}</span>`;
                }
                // Null
                if (match === 'null') {
                    return `<span class="json-null">${match}</span>`;
                }
                return match;
            },
        );
    }

    // -------------------------------------------------------------------------
    // YAML highlighting
    // -------------------------------------------------------------------------

    private highlightYaml(yaml: string): string {
        return yaml
            .split('\n')
            .map((line) => this.highlightYamlLine(line))
            .join('\n');
    }

    private highlightYamlLine(line: string): string {
        const escaped = this.escapeHtml(line);

        // Comment line
        if (/^\s*#/.test(escaped)) {
            return `<span class="yaml-comment">${escaped}</span>`;
        }

        // Key: value  (key ends at first colon not inside a quoted string)
        const keyValueMatch = /^(\s*)([\w-]+)(\s*:\s*)(.*)$/.exec(escaped);
        if (keyValueMatch) {
            const [, indent, key, separator, rest] = keyValueMatch;
            const styledKey = `<span class="yaml-key">${key}</span>`;

            if (rest.trim().length === 0) {
                // Key-only line (mapping start)
                return `${indent}${styledKey}${separator}`;
            }

            // Inline comment within value
            const commentIdx = rest.indexOf(' #');
            if (commentIdx !== -1) {
                const valuePart = rest.slice(0, commentIdx);
                const commentPart = rest.slice(commentIdx);
                return `${indent}${styledKey}${separator}<span class="yaml-value">${valuePart}</span><span class="yaml-comment">${commentPart}</span>`;
            }

            return `${indent}${styledKey}${separator}<span class="yaml-value">${rest}</span>`;
        }

        // List item (starts with -)
        const listMatch = /^(\s*-\s+)(.*)$/.exec(escaped);
        if (listMatch) {
            const [, bullet, value] = listMatch;
            return `${bullet}<span class="yaml-value">${value}</span>`;
        }

        return escaped;
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
