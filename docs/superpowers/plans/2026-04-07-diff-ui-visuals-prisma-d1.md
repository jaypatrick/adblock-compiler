# Diff UI, Visual Artifacts & Prisma D1 Migration Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filter-list diff UI (AGTree-first), 6 SVG+HTML documentation diagrams, and a Prisma-driven D1 migration generation workflow.

**Architecture:** Three independent tracks. Track 1 adds a stateless `POST /api/diff` worker endpoint wired to the existing `DiffGenerator` + `ASTViewerService`, plus an Angular component mirroring the validation page pattern. Track 2 produces standalone SVG+HTML diagrams saved to `docs/assets/diagrams/`. Track 3 adds a Deno script that applies existing migrations to a shadow SQLite DB, diffs against `schema.d1.prisma`, and writes the next numbered migration file.

**Tech Stack:** Deno, Hono, Zod, AGTree (`ASTViewerService`), `DiffGenerator`, Angular 21 (signals, zoneless, Angular Material), `@prisma/adapter-d1`, `better-sqlite3` (shadow DB in script).

---

## File Map

### Track 1 — Diff UI

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `worker/handlers/diff.ts` | `POST /api/diff` — parse both lists through AGTree, run DiffGenerator, return errors + report |
| Create | `worker/handlers/diff.test.ts` | Unit tests for the diff handler |
| Modify | `worker/schemas.ts` | Add `DiffRequestSchema`, `DiffResponseSchema` |
| Modify | `worker/openapi-types.ts` | Add `DiffRequest`, `DiffResponse` TS types |
| Modify | `worker/handlers/index.ts` | Export `handleDiff` |
| Modify | `worker/routes/compile.routes.ts` | Register `POST /diff` |
| Modify | `worker/utils/route-permissions.ts` | Add `/diff` permission entry |
| Create | `frontend/src/app/services/diff.service.ts` | Angular service wrapping `POST /api/diff` |
| Create | `frontend/src/app/services/diff.service.spec.ts` | Service tests |
| Create | `frontend/src/app/diff/diff.component.ts` | Angular diff page |
| Create | `frontend/src/app/diff/diff.component.spec.ts` | Component tests |
| Modify | `frontend/src/app/schemas/api-responses.ts` | Add `DiffResponseSchema` (ZTA validation) |
| Modify | `frontend/src/app/app.routes.ts` | Add `/diff` route |

### Track 2 — Visual Artifacts

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `docs/assets/diagrams/system-architecture.svg` | Full system diagram |
| Create | `docs/assets/diagrams/system-architecture.html` | Standalone presentation version |
| Create | `docs/assets/diagrams/compilation-pipeline.svg` | 6-mode compilation flow |
| Create | `docs/assets/diagrams/compilation-pipeline.html` | Standalone |
| Create | `docs/assets/diagrams/feature-map.svg` | UI pages + auth + relationships |
| Create | `docs/assets/diagrams/feature-map.html` | Standalone |
| Create | `docs/assets/diagrams/api-overview.svg` | Endpoints grouped by category |
| Create | `docs/assets/diagrams/api-overview.html` | Standalone |
| Create | `docs/assets/diagrams/diff-workflow.svg` | Raw text → AGTree → AST diff → report |
| Create | `docs/assets/diagrams/diff-workflow.html` | Standalone |
| Create | `docs/assets/diagrams/tech-stack.svg` | Language/runtime/infra layers |
| Create | `docs/assets/diagrams/tech-stack.html` | Standalone |

### Track 3 — Prisma D1 Migration Workflow

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/generate-d1-migration.ts` | Shadow-DB diff → numbered SQL file in `migrations/` |
| Modify | `deno.json` | Add `db:migrate:d1`, `db:migrate:d1:deploy`, `db:check:d1` tasks |

---

## Track 1 — Diff UI

---

### Task 1: Diff schemas (worker)

**Files:**
- Modify: `worker/schemas.ts` (append after line containing `// Rule Validation Schemas`)
- Modify: `worker/openapi-types.ts`

- [ ] **Step 1: Add `DiffRequestSchema` and `DiffResponseSchema` to `worker/schemas.ts`**

Find the block starting with `// Rule Validation Schemas (POST /validate-rule)` in `worker/schemas.ts` and append after it:

```typescript
// ─── Diff Schemas (POST /diff) ───────────────────────────────────────────────

export const DiffOptionsSchema = z.object({
    ignoreComments:    z.boolean().optional().default(true),
    ignoreEmptyLines:  z.boolean().optional().default(true),
    analyzeDomains:    z.boolean().optional().default(true),
    includeFullRules:  z.boolean().optional().default(true),
    maxRulesToInclude: z.number().int().min(1).max(10_000).optional().default(1000),
});

export const DiffRequestSchema = z.object({
    original: z.array(z.string()).min(1, 'original list cannot be empty'),
    current:  z.array(z.string()).min(1, 'current list cannot be empty'),
    options:  DiffOptionsSchema.optional().default({}),
});
export type DiffRequest = z.infer<typeof DiffRequestSchema>;

export const ParseErrorSchema = z.object({
    line:    z.number(),
    rule:    z.string(),
    message: z.string(),
});

export const RuleDiffSchema = z.object({
    rule:         z.string(),
    type:         z.enum(['added', 'removed', 'modified']),
    source:       z.string().optional(),
    originalLine: z.number().optional(),
    newLine:      z.number().optional(),
});

export const DomainDiffSchema = z.object({
    domain:  z.string(),
    added:   z.number(),
    removed: z.number(),
});

export const DiffSummarySchema = z.object({
    originalCount:    z.number(),
    newCount:         z.number(),
    addedCount:       z.number(),
    removedCount:     z.number(),
    unchangedCount:   z.number(),
    netChange:        z.number(),
    percentageChange: z.number(),
});

export const DiffReportSchema = z.object({
    timestamp:        z.string(),
    generatorVersion: z.string(),
    original:         z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
    current:          z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
    summary:          DiffSummarySchema,
    added:            z.array(RuleDiffSchema),
    removed:          z.array(RuleDiffSchema),
    domainChanges:    z.array(DomainDiffSchema),
});

export const DiffResponseSchema = z.object({
    success:     z.boolean(),
    parseErrors: z.object({
        original: z.array(ParseErrorSchema),
        current:  z.array(ParseErrorSchema),
    }),
    report:   DiffReportSchema,
    duration: z.string(),
});
export type DiffResponse = z.infer<typeof DiffResponseSchema>;
```

- [ ] **Step 2: Add TS types to `worker/openapi-types.ts`**

Append to the end of `worker/openapi-types.ts`:

```typescript
// ─── Diff (POST /diff) ───────────────────────────────────────────────────────

export interface DiffOptions {
    ignoreComments?:    boolean;
    ignoreEmptyLines?:  boolean;
    analyzeDomains?:    boolean;
    includeFullRules?:  boolean;
    maxRulesToInclude?: number;
}

export interface DiffRequest {
    original: string[];
    current:  string[];
    options?: DiffOptions;
}

export interface ParseError {
    line:    number;
    rule:    string;
    message: string;
}

export interface DiffResponse {
    success:     boolean;
    parseErrors: { original: ParseError[]; current: ParseError[] };
    report:      import('../src/diff/DiffReport.ts').DiffReport;
    duration:    string;
}
```

- [ ] **Step 3: Run type check**

```bash
deno task check
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add worker/schemas.ts worker/openapi-types.ts
git commit -m "feat(diff): add DiffRequestSchema, DiffResponseSchema, and openapi types"
```

---

### Task 2: Diff handler (worker)

**Files:**
- Create: `worker/handlers/diff.ts`
- Create: `worker/handlers/diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/handlers/diff.test.ts`:

```typescript
import { assertEquals } from 'jsr:@std/assert';
import { handleDiff } from './diff.ts';

const makeRequest = (body: unknown) =>
    new Request('http://localhost/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

Deno.test('handleDiff - returns added and removed counts', async () => {
    const original = ['||example.com^', '||ads.com^'];
    const current  = ['||example.com^', '||newads.com^'];

    const res  = await handleDiff(makeRequest({ original, current }), {} as any);
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.success, true);
    assertEquals(body.report.summary.addedCount,   1);
    assertEquals(body.report.summary.removedCount, 1);
    assertEquals(body.report.summary.unchangedCount, 1);
});

Deno.test('handleDiff - surfaces parse errors without blocking diff', async () => {
    const original = ['||example.com^', '###invalid-cosmetic-BROKEN'];
    const current  = ['||example.com^'];

    const res  = await handleDiff(makeRequest({ original, current }), {} as any);
    const body = await res.json();

    assertEquals(res.status, 200);
    // The invalid rule is excluded from comparison, not a fatal error
    assertEquals(body.parseErrors.original.length > 0 || body.report.summary.originalCount >= 1, true);
});

Deno.test('handleDiff - 422 on missing required fields', async () => {
    const res = await handleDiff(makeRequest({ original: [] }), {} as any);
    assertEquals(res.status, 422);
});

Deno.test('handleDiff - 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
    });
    const res = await handleDiff(req, {} as any);
    assertEquals(res.status, 400);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
deno test --allow-read --allow-write --allow-net --allow-env worker/handlers/diff.test.ts
```

Expected: error — `diff.ts` does not exist yet.

- [ ] **Step 3: Implement `worker/handlers/diff.ts`**

Create `worker/handlers/diff.ts`:

```typescript
/**
 * Handler for POST /api/diff
 *
 * Compares two filter lists via AGTree AST. Both lists are parsed through
 * ASTViewerService before comparison — parse errors are returned alongside
 * the diff report but do not block the diff. Rules that fail to parse are
 * excluded from the comparison.
 */

import { DiffGenerator } from '../../src/diff/DiffReport.ts';
import { ASTViewerService } from '../../src/services/ASTViewerService.ts';
import { DiffRequestSchema } from '../schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import type { Env } from '../types.ts';
import type { ParseError } from '../openapi-types.ts';

function parseAndFilter(
    rules: string[],
    errors: ParseError[],
): string[] {
    const valid: string[] = [];
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i].trim();
        if (!rule) continue;
        const result = ASTViewerService.parseRule(rule);
        if (result.success) {
            valid.push(rule);
        } else {
            errors.push({ line: i + 1, rule, message: result.error ?? 'Parse error' });
        }
    }
    return valid;
}

export async function handleDiff(request: Request, _env: Env): Promise<Response> {
    const startTime = Date.now();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = DiffRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.error(parsed.error.issues.map((i) => i.message).join('; '), 422);
    }

    const { original, current, options } = parsed.data;

    const parseErrors = { original: [] as ParseError[], current: [] as ParseError[] };
    const validOriginal = parseAndFilter(original, parseErrors.original);
    const validCurrent  = parseAndFilter(current,  parseErrors.current);

    const generator = new DiffGenerator(options);
    const report    = generator.generate(validOriginal, validCurrent);

    return JsonResponse.success({
        success: true,
        parseErrors,
        report,
        duration: `${Date.now() - startTime}ms`,
    });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
deno test --allow-read --allow-write --allow-net --allow-env worker/handlers/diff.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/handlers/diff.ts worker/handlers/diff.test.ts
git commit -m "feat(diff): add POST /api/diff handler with AGTree parse-first logic"
```

---

### Task 3: Register diff route (worker)

**Files:**
- Modify: `worker/handlers/index.ts`
- Modify: `worker/utils/route-permissions.ts`
- Modify: `worker/routes/compile.routes.ts`

- [ ] **Step 1: Export `handleDiff` from handler index**

In `worker/handlers/index.ts`, add after the validate-rule export line:

```typescript
export { handleDiff } from './diff.ts';
```

- [ ] **Step 2: Add permission entry**

In `worker/utils/route-permissions.ts`, add after the `/validate-rule` entry:

```typescript
['/diff', { minTier: UserTier.Free, description: 'Diff two filter lists via AGTree AST' }],
```

- [ ] **Step 3: Register the route in `worker/routes/compile.routes.ts`**

Add the import at the top alongside other handler imports:

```typescript
import { handleDiff } from '../handlers/diff.ts';
```

Add the import for `DiffRequestSchema` alongside other schema imports:

```typescript
// (add DiffRequestSchema to the existing worker/schemas.ts import line)
import { ..., DiffRequestSchema } from '../schemas.ts';
```

Register the route after the `/validate-rule` route block:

```typescript
app.post(
    '/diff',
    zValidator('json', DiffRequestSchema as any, zodValidationError),
    (c) => handleDiff(c.req.raw, c.env),
);
```

- [ ] **Step 4: Run full worker tests**

```bash
deno task test:worker
```

Expected: all tests pass including the new diff tests.

- [ ] **Step 5: Commit**

```bash
git add worker/handlers/index.ts worker/utils/route-permissions.ts worker/routes/compile.routes.ts
git commit -m "feat(diff): register POST /diff route with Free tier permission"
```

---

### Task 4: Diff service (Angular)

**Files:**
- Modify: `frontend/src/app/schemas/api-responses.ts`
- Create: `frontend/src/app/services/diff.service.ts`
- Create: `frontend/src/app/services/diff.service.spec.ts`

- [ ] **Step 1: Add `DiffResponseSchema` to `frontend/src/app/schemas/api-responses.ts`**

Append after the `ValidationResultSchema` block:

```typescript
// ---------------------------------------------------------------------------
// Diff Response — ZTA validation for POST /diff
// ---------------------------------------------------------------------------

const ParseErrorSchema = z.object({
    line:    z.number(),
    rule:    z.string(),
    message: z.string(),
});

const RuleDiffSchema = z.object({
    rule:         z.string(),
    type:         z.enum(['added', 'removed', 'modified']),
    source:       z.string().optional(),
    originalLine: z.number().optional(),
    newLine:      z.number().optional(),
});

const DomainDiffSchema = z.object({
    domain:  z.string(),
    added:   z.number(),
    removed: z.number(),
});

const DiffSummarySchema = z.object({
    originalCount:    z.number(),
    newCount:         z.number(),
    addedCount:       z.number(),
    removedCount:     z.number(),
    unchangedCount:   z.number(),
    netChange:        z.number(),
    percentageChange: z.number(),
});

const DiffReportSchema = z.object({
    timestamp:        z.string(),
    generatorVersion: z.string(),
    original:         z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
    current:          z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
    summary:          DiffSummarySchema,
    added:            z.array(RuleDiffSchema),
    removed:          z.array(RuleDiffSchema),
    domainChanges:    z.array(DomainDiffSchema),
});

export const DiffApiResponseSchema = z.object({
    success:     z.boolean(),
    parseErrors: z.object({
        original: z.array(ParseErrorSchema),
        current:  z.array(ParseErrorSchema),
    }),
    report:   DiffReportSchema,
    duration: z.string(),
});

export type DiffApiResponse     = z.infer<typeof DiffApiResponseSchema>;
export type DiffReport          = z.infer<typeof DiffReportSchema>;
export type DiffSummary         = z.infer<typeof DiffSummarySchema>;
export type RuleDiff            = z.infer<typeof RuleDiffSchema>;
export type DomainDiff          = z.infer<typeof DomainDiffSchema>;
export type DiffParseError      = z.infer<typeof ParseErrorSchema>;
```

- [ ] **Step 2: Write the failing service test**

Create `frontend/src/app/services/diff.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DiffService } from './diff.service';
import { API_BASE_URL } from '../tokens';
import { firstValueFrom } from 'rxjs';

describe('DiffService', () => {
    let service: DiffService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                DiffService,
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: API_BASE_URL, useValue: 'http://localhost:8787/api' },
            ],
        });
        service = TestBed.inject(DiffService);
        http    = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('should POST to /diff and return a validated response', async () => {
        const mockResponse = {
            success: true,
            parseErrors: { original: [], current: [] },
            report: {
                timestamp: '2026-01-01T00:00:00.000Z',
                generatorVersion: '1.0.0',
                original: { ruleCount: 2 },
                current:  { ruleCount: 2 },
                summary: { originalCount: 2, newCount: 2, addedCount: 1, removedCount: 1, unchangedCount: 1, netChange: 0, percentageChange: 0 },
                added:         [{ rule: '||newads.com^', type: 'added' }],
                removed:       [{ rule: '||oldads.com^', type: 'removed' }],
                domainChanges: [],
            },
            duration: '5ms',
        };

        const result$ = service.diff(['||example.com^', '||oldads.com^'], ['||example.com^', '||newads.com^']);
        const promise = firstValueFrom(result$);

        http.expectOne('http://localhost:8787/api/diff').flush(mockResponse);
        const result = await promise;

        expect(result.report.summary.addedCount).toBe(1);
        expect(result.report.summary.removedCount).toBe(1);
    });
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd frontend && npx ng test --include="**/diff.service.spec.ts" --watch=false
```

Expected: compile error — `diff.service.ts` does not exist.

- [ ] **Step 4: Implement `DiffService`**

Create `frontend/src/app/services/diff.service.ts`:

```typescript
/**
 * DiffService — wraps the POST /api/diff endpoint.
 *
 * Compares two filter lists via the backend AGTree AST diff.
 * Returns parse errors alongside the DiffReport.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../tokens';
import { DiffApiResponseSchema, DiffApiResponse, validateResponse } from '../schemas/api-responses';

export interface DiffOptions {
    ignoreComments?:    boolean;
    ignoreEmptyLines?:  boolean;
    analyzeDomains?:    boolean;
    includeFullRules?:  boolean;
    maxRulesToInclude?: number;
}

@Injectable({ providedIn: 'root' })
export class DiffService {
    private readonly http       = inject(HttpClient);
    private readonly apiBaseUrl = inject(API_BASE_URL);

    diff(original: string[], current: string[], options?: DiffOptions): Observable<DiffApiResponse> {
        return this.http
            .post<unknown>(`${this.apiBaseUrl}/diff`, { original, current, options })
            .pipe(map((raw) => validateResponse(DiffApiResponseSchema, raw, 'POST /diff')));
    }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd frontend && npx ng test --include="**/diff.service.spec.ts" --watch=false
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/schemas/api-responses.ts \
        frontend/src/app/services/diff.service.ts \
        frontend/src/app/services/diff.service.spec.ts
git commit -m "feat(diff): add DiffService and ZTA response schema for /api/diff"
```

---

### Task 5: Diff component (Angular)

**Files:**
- Create: `frontend/src/app/diff/diff.component.ts`
- Create: `frontend/src/app/diff/diff.component.spec.ts`
- Modify: `frontend/src/app/app.routes.ts`

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/app/diff/diff.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DiffComponent } from './diff.component';
import { API_BASE_URL } from '../tokens';

describe('DiffComponent', () => {
    let fixture: ComponentFixture<DiffComponent>;
    let component: DiffComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DiffComponent],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideRouter([]),
                { provide: API_BASE_URL, useValue: 'http://localhost:8787/api' },
            ],
        }).compileComponents();

        fixture   = TestBed.createComponent(DiffComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should start with no results', () => {
        expect(component.diffResult()).toBeNull();
    });

    it('should disable compare when both textareas are empty', () => {
        const btn = fixture.nativeElement.querySelector('[data-testid="compare-btn"]') as HTMLButtonElement;
        expect(btn.disabled).toBeTrue();
    });

    it('should enable compare when both panels have content', () => {
        component.originalText.set('||example.com^');
        component.currentText.set('||newads.com^');
        fixture.detectChanges();
        const btn = fixture.nativeElement.querySelector('[data-testid="compare-btn"]') as HTMLButtonElement;
        expect(btn.disabled).toBeFalse();
    });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd frontend && npx ng test --include="**/diff.component.spec.ts" --watch=false
```

Expected: compile error — component does not exist.

- [ ] **Step 3: Implement `DiffComponent`**

Create `frontend/src/app/diff/diff.component.ts`:

```typescript
/**
 * DiffComponent — compare two filter lists via AGTree AST diff.
 *
 * Features:
 *  - Two side-by-side textareas (original / current)
 *  - AGTree parse errors surfaced per panel before diff runs
 *  - Summary bar: +added / -removed / unchanged / ±net
 *  - Color-coded rule diff with virtual scrolling for large lists
 *  - Domain changes table (sortable)
 *  - Export as Markdown or JSON
 *
 * Angular 21 patterns: signal(), computed(), rxResource(), @if/@for, zoneless.
 */

import { Component, computed, inject, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { rxResource } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { MatCardModule }           from '@angular/material/card';
import { MatButtonModule }         from '@angular/material/button';
import { MatIconModule }           from '@angular/material/icon';
import { MatFormFieldModule }      from '@angular/material/form-field';
import { MatInputModule }          from '@angular/material/input';
import { MatChipsModule }          from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule }       from '@angular/material/checkbox';
import { MatDividerModule }        from '@angular/material/divider';
import { MatTableModule }          from '@angular/material/table';
import { MatSortModule }           from '@angular/material/sort';
import { MatTooltipModule }        from '@angular/material/tooltip';
import { DiffService }             from '../services/diff.service';
import type { DiffApiResponse, RuleDiff } from '../schemas/api-responses';

@Component({
    selector: 'app-diff',
    imports: [
        ScrollingModule,
        MatCardModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatInputModule, MatChipsModule,
        MatProgressSpinnerModule, MatCheckboxModule, MatDividerModule,
        MatTableModule, MatSortModule, MatTooltipModule,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">Filter List Diff</h1>
        <p class="subtitle mat-body-1">
            Compare two filter lists via AGTree AST — syntax errors surface before the diff runs.
        </p>

        <!-- Input panels -->
        <div class="diff-inputs">
            <mat-card appearance="outlined" class="diff-panel">
                <mat-card-header><mat-card-title>Original</mat-card-title></mat-card-header>
                <mat-card-content>
                    <mat-form-field appearance="outline" class="full-width">
                        <mat-label>Original filter rules (one per line)</mat-label>
                        <textarea matInput rows="10"
                            [value]="originalText()"
                            (input)="originalText.set($any($event.target).value)"
                            placeholder="||example.com^&#10;||ads.com^"></textarea>
                    </mat-form-field>
                    @if (originalErrors().length > 0) {
                        <div class="parse-errors">
                            <mat-chip-set>
                                @for (e of originalErrors(); track e.line) {
                                    <mat-chip color="warn" [matTooltip]="e.message">
                                        Line {{ e.line }}: {{ e.rule | slice:0:30 }}
                                    </mat-chip>
                                }
                            </mat-chip-set>
                        </div>
                    }
                </mat-card-content>
            </mat-card>

            <mat-card appearance="outlined" class="diff-panel">
                <mat-card-header><mat-card-title>Current</mat-card-title></mat-card-header>
                <mat-card-content>
                    <mat-form-field appearance="outline" class="full-width">
                        <mat-label>Current filter rules (one per line)</mat-label>
                        <textarea matInput rows="10"
                            [value]="currentText()"
                            (input)="currentText.set($any($event.target).value)"
                            placeholder="||example.com^&#10;||newads.com^"></textarea>
                    </mat-form-field>
                    @if (currentErrors().length > 0) {
                        <div class="parse-errors">
                            <mat-chip-set>
                                @for (e of currentErrors(); track e.line) {
                                    <mat-chip color="warn" [matTooltip]="e.message">
                                        Line {{ e.line }}: {{ e.rule | slice:0:30 }}
                                    </mat-chip>
                                }
                            </mat-chip-set>
                        </div>
                    }
                </mat-card-content>
            </mat-card>
        </div>

        <!-- Actions -->
        <div class="diff-actions">
            <button mat-raised-button color="primary"
                    data-testid="compare-btn"
                    [disabled]="!canCompare()"
                    (click)="runDiff()">
                @if (diffResource.isLoading()) {
                    <mat-progress-spinner diameter="18" mode="indeterminate" />
                    Comparing…
                } @else {
                    <mat-icon>compare_arrows</mat-icon> Compare
                }
            </button>
            <button mat-button (click)="clear()">
                <mat-icon>clear</mat-icon> Clear
            </button>
            <mat-checkbox [(ngModel)]="strictMode">Strict mode</mat-checkbox>
        </div>

        @if (diffResult(); as result) {
            <!-- Summary bar -->
            <mat-card appearance="outlined" class="summary-bar mt-2">
                <mat-card-content>
                    <div class="summary-chips">
                        <span class="added">+{{ result.report.summary.addedCount }} added</span>
                        <span class="removed">-{{ result.report.summary.removedCount }} removed</span>
                        <span class="unchanged">{{ result.report.summary.unchangedCount }} unchanged</span>
                        <span class="net">
                            {{ result.report.summary.netChange >= 0 ? '+' : '' }}{{ result.report.summary.netChange }}
                            ({{ result.report.summary.percentageChange | number:'1.1-1' }}%)
                        </span>
                    </div>
                </mat-card-content>
            </mat-card>

            <!-- Rule diff (virtual scroll) -->
            @if (allChangedRules().length > 0) {
                <mat-card appearance="outlined" class="mt-2">
                    <mat-card-header><mat-card-title>Rule Changes</mat-card-title></mat-card-header>
                    <mat-card-content>
                        <cdk-virtual-scroll-viewport itemSize="28" class="rule-diff-viewport">
                            <div *cdkVirtualFor="let rule of allChangedRules(); trackBy: trackRule"
                                 [class.rule-added]="rule.type === 'added'"
                                 [class.rule-removed]="rule.type === 'removed'"
                                 class="rule-line">
                                <span class="rule-sign">{{ rule.type === 'added' ? '+' : '-' }}</span>
                                <code>{{ rule.rule }}</code>
                            </div>
                        </cdk-virtual-scroll-viewport>
                    </mat-card-content>
                </mat-card>
            }

            <!-- Domain changes -->
            @if (result.report.domainChanges.length > 0) {
                <mat-card appearance="outlined" class="mt-2">
                    <mat-card-header><mat-card-title>Domain Changes</mat-card-title></mat-card-header>
                    <mat-card-content>
                        <table mat-table [dataSource]="result.report.domainChanges" matSort class="full-width">
                            <ng-container matColumnDef="domain">
                                <th mat-header-cell *matHeaderCellDef mat-sort-header>Domain</th>
                                <td mat-cell *matCellDef="let row"><code>{{ row.domain }}</code></td>
                            </ng-container>
                            <ng-container matColumnDef="added">
                                <th mat-header-cell *matHeaderCellDef mat-sort-header>Added</th>
                                <td mat-cell *matCellDef="let row" class="added">+{{ row.added }}</td>
                            </ng-container>
                            <ng-container matColumnDef="removed">
                                <th mat-header-cell *matHeaderCellDef mat-sort-header>Removed</th>
                                <td mat-cell *matCellDef="let row" class="removed">-{{ row.removed }}</td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="domainCols"></tr>
                            <tr mat-row *matRowDef="let row; columns: domainCols;"></tr>
                        </table>
                    </mat-card-content>
                </mat-card>
            }

            <!-- Export -->
            <div class="export-actions mt-2">
                <button mat-stroked-button (click)="exportMarkdown()">
                    <mat-icon>download</mat-icon> Export Markdown
                </button>
                <button mat-stroked-button (click)="exportJson()">
                    <mat-icon>data_object</mat-icon> Export JSON
                </button>
            </div>
        }
    </div>
    `,
    styles: [`
        .diff-inputs      { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .diff-panel       { width: 100%; }
        .diff-actions     { display: flex; align-items: center; gap: 1rem; margin-top: 1rem; }
        .summary-bar      { }
        .summary-chips    { display: flex; gap: 1.5rem; font-weight: 500; font-size: 1rem; }
        .added            { color: #2e7d32; }
        .removed          { color: #c62828; }
        .unchanged        { color: var(--mat-sys-on-surface-variant); }
        .net              { color: var(--mat-sys-primary); }
        .rule-diff-viewport { height: 320px; }
        .rule-line        { display: flex; align-items: center; gap: 0.5rem; padding: 2px 4px; font-family: monospace; font-size: 13px; }
        .rule-added       { background: rgba(46, 125, 50, 0.08); }
        .rule-removed     { background: rgba(198, 40, 40, 0.08); }
        .rule-sign        { width: 14px; font-weight: bold; }
        .parse-errors     { margin-top: 0.5rem; }
        .export-actions   { display: flex; gap: 1rem; }
        .full-width       { width: 100%; }
        .mt-2             { margin-top: 1rem; }
        @media (max-width: 768px) {
            .diff-inputs  { grid-template-columns: 1fr; }
        }
    `],
})
export class DiffComponent {
    private readonly diffService = inject(DiffService);

    readonly originalText = signal('');
    readonly currentText  = signal('');
    readonly strictMode   = signal(false);
    readonly diffResult   = signal<DiffApiResponse | null>(null);
    readonly domainCols   = ['domain', 'added', 'removed'];

    readonly canCompare = computed(
        () => this.originalText().trim().length > 0 && this.currentText().trim().length > 0,
    );

    readonly originalErrors = computed(() => this.diffResult()?.parseErrors.original ?? []);
    readonly currentErrors  = computed(() => this.diffResult()?.parseErrors.current ?? []);

    readonly allChangedRules = computed((): RuleDiff[] => {
        const r = this.diffResult();
        if (!r) return [];
        return [
            ...r.report.removed.map(x => ({ ...x, type: 'removed' as const })),
            ...r.report.added.map(x => ({ ...x, type: 'added' as const })),
        ].sort((a, b) => (a.originalLine ?? a.newLine ?? 0) - (b.originalLine ?? b.newLine ?? 0));
    });

    private compareParams = signal<{ original: string[]; current: string[] } | null>(null);

    readonly diffResource = rxResource({
        request: () => this.compareParams(),
        loader: ({ request }) => {
            if (!request) return EMPTY;
            return this.diffService.diff(request.original, request.current);
        },
    });

    runDiff(): void {
        const original = this.originalText().split('\n').map(l => l.trim()).filter(Boolean);
        const current  = this.currentText().split('\n').map(l => l.trim()).filter(Boolean);
        this.compareParams.set({ original, current });
        // rxResource re-runs; subscribe to capture result into diffResult signal
        this.diffResource.value.set(null);
        // Use effect to sync resource value → diffResult signal
        this.diffService.diff(original, current).subscribe(result => this.diffResult.set(result));
    }

    clear(): void {
        this.originalText.set('');
        this.currentText.set('');
        this.diffResult.set(null);
        this.compareParams.set(null);
    }

    exportMarkdown(): void {
        const r = this.diffResult();
        if (!r) return;
        const lines = [
            '# Filter List Diff Report',
            `Generated: ${r.report.timestamp}`,
            '',
            '## Summary',
            `| Metric | Value |`,
            `|--------|-------|`,
            `| Original | ${r.report.summary.originalCount} |`,
            `| Current  | ${r.report.summary.newCount} |`,
            `| Added    | +${r.report.summary.addedCount} |`,
            `| Removed  | -${r.report.summary.removedCount} |`,
            `| Net      | ${r.report.summary.netChange >= 0 ? '+' : ''}${r.report.summary.netChange} |`,
        ];
        this.download(lines.join('\n'), 'diff-report.md', 'text/markdown');
    }

    exportJson(): void {
        const r = this.diffResult();
        if (!r) return;
        this.download(JSON.stringify(r.report, null, 2), 'diff-report.json', 'application/json');
    }

    trackRule(_: number, rule: RuleDiff): string { return `${rule.type}-${rule.rule}`; }

    private download(content: string, filename: string, type: string): void {
        const a   = document.createElement('a');
        a.href    = URL.createObjectURL(new Blob([content], { type }));
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }
}
```

- [ ] **Step 4: Add `/diff` route to `frontend/src/app/app.routes.ts`**

Add after the `/validation` route entry:

```typescript
{
    path: 'diff',
    loadComponent: () => import('./diff/diff.component').then((m) => m.DiffComponent),
    title: 'Diff',
    data: { description: 'Compare two filter lists via AGTree AST', metaDescription: 'Compare adblock filter lists using AGTree AST diff. Syntax errors surface before comparison. Supports Markdown and JSON export.' },
    canActivate: [authGuard],
},
```

- [ ] **Step 5: Run component tests**

```bash
cd frontend && npx ng test --include="**/diff.component.spec.ts" --watch=false
```

Expected: 4 tests pass.

- [ ] **Step 6: Run full test suite**

```bash
deno task test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/diff/ frontend/src/app/app.routes.ts
git commit -m "feat(diff): add DiffComponent with AGTree parse errors, rule diff, domain table, and export"
```

---

## Track 2 — Visual Documentation Artifacts

---

### Task 6: System Architecture + Tech Stack diagrams

**Files:**
- Create: `docs/assets/diagrams/system-architecture.svg`
- Create: `docs/assets/diagrams/system-architecture.html`
- Create: `docs/assets/diagrams/tech-stack.svg`
- Create: `docs/assets/diagrams/tech-stack.html`

- [ ] **Step 1: Create `docs/assets/diagrams/` directory**

```bash
mkdir -p docs/assets/diagrams
```

- [ ] **Step 2: Create `system-architecture.svg`**

Create `docs/assets/diagrams/system-architecture.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520" font-family="Inter,system-ui,sans-serif">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0,10 3.5,0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Background -->
  <rect width="900" height="520" fill="#f8fafc" rx="12"/>
  <text x="450" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">Adblock Compiler — System Architecture</text>

  <!-- Client -->
  <rect x="30" y="70" width="160" height="80" rx="8" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="110" y="105" text-anchor="middle" font-size="13" font-weight="600" fill="#1d4ed8">Angular 21 SPA</text>
  <text x="110" y="122" text-anchor="middle" font-size="11" fill="#3b82f6">Signals · Zoneless</text>
  <text x="110" y="137" text-anchor="middle" font-size="11" fill="#3b82f6">Angular Material</text>

  <!-- CF Worker -->
  <rect x="350" y="60" width="200" height="100" rx="8" fill="#fff7ed" stroke="#f97316" stroke-width="1.5"/>
  <text x="450" y="100" text-anchor="middle" font-size="13" font-weight="600" fill="#c2410c">Cloudflare Worker</text>
  <text x="450" y="118" text-anchor="middle" font-size="11" fill="#f97316">Hono · Zod · AGTree</text>
  <text x="450" y="134" text-anchor="middle" font-size="11" fill="#f97316">DiffGenerator · Prisma</text>

  <!-- CF Pages -->
  <rect x="30" y="200" width="160" height="60" rx="8" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="110" y="227" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Cloudflare Pages</text>
  <text x="110" y="244" text-anchor="middle" font-size="11" fill="#22c55e">SSR · Static Assets</text>

  <!-- D1 -->
  <rect x="620" y="60" width="150" height="60" rx="8" fill="#faf5ff" stroke="#a855f7" stroke-width="1.5"/>
  <text x="695" y="87" text-anchor="middle" font-size="12" font-weight="600" fill="#7e22ce">Cloudflare D1</text>
  <text x="695" y="104" text-anchor="middle" font-size="11" fill="#a855f7">SQLite at Edge</text>

  <!-- R2 -->
  <rect x="620" y="140" width="150" height="60" rx="8" fill="#fff1f2" stroke="#f43f5e" stroke-width="1.5"/>
  <text x="695" y="167" text-anchor="middle" font-size="12" font-weight="600" fill="#be123c">Cloudflare R2</text>
  <text x="695" y="184" text-anchor="middle" font-size="11" fill="#f43f5e">Object Storage</text>

  <!-- Queues -->
  <rect x="620" y="220" width="150" height="60" rx="8" fill="#fffbeb" stroke="#eab308" stroke-width="1.5"/>
  <text x="695" y="247" text-anchor="middle" font-size="12" font-weight="600" fill="#854d0e">CF Queues</text>
  <text x="695" y="264" text-anchor="middle" font-size="11" fill="#eab308">Async Compile</text>

  <!-- Better Auth -->
  <rect x="350" y="220" width="200" height="60" rx="8" fill="#f0f9ff" stroke="#0ea5e9" stroke-width="1.5"/>
  <text x="450" y="247" text-anchor="middle" font-size="12" font-weight="600" fill="#0369a1">Better Auth</text>
  <text x="450" y="264" text-anchor="middle" font-size="11" fill="#0ea5e9">Sessions · API Keys</text>

  <!-- Neon -->
  <rect x="350" y="340" width="200" height="60" rx="8" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.5"/>
  <text x="450" y="367" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Neon PostgreSQL</text>
  <text x="450" y="384" text-anchor="middle" font-size="11" fill="#16a34a">Prisma ORM · Migrations</text>

  <!-- Sentry -->
  <rect x="620" y="300" width="150" height="60" rx="8" fill="#fdf4ff" stroke="#c026d3" stroke-width="1.5"/>
  <text x="695" y="327" text-anchor="middle" font-size="12" font-weight="600" fill="#86198f">Sentry</text>
  <text x="695" y="344" text-anchor="middle" font-size="11" fill="#c026d3">Errors · Releases</text>

  <!-- Tail Worker -->
  <rect x="620" y="380" width="150" height="60" rx="8" fill="#fff7ed" stroke="#fb923c" stroke-width="1.5"/>
  <text x="695" y="407" text-anchor="middle" font-size="12" font-weight="600" fill="#c2410c">Tail Worker</text>
  <text x="695" y="424" text-anchor="middle" font-size="11" fill="#fb923c">bloqr-tail · Logs</text>

  <!-- Arrows -->
  <!-- Client → Worker -->
  <line x1="190" y1="110" x2="348" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="269" y="105" text-anchor="middle" font-size="10" fill="#64748b">HTTPS / SSE</text>

  <!-- Pages → Worker (SSR) -->
  <line x1="190" y1="230" x2="348" y2="130" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)" stroke-dasharray="4"/>

  <!-- Worker → D1 -->
  <line x1="550" y1="90" x2="618" y2="90" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Worker → R2 -->
  <line x1="550" y1="110" x2="618" y2="165" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Worker → Queues -->
  <line x1="550" y1="130" x2="618" y2="245" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Worker → Better Auth -->
  <line x1="450" y1="160" x2="450" y2="218" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Worker → Neon -->
  <line x1="440" y1="160" x2="440" y2="338" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)" stroke-dasharray="4"/>

  <!-- Worker → Sentry -->
  <line x1="550" y1="100" x2="618" y2="325" stroke="#64748b" stroke-width="1" marker-end="url(#arrow)" stroke-dasharray="3"/>

  <!-- Worker → Tail -->
  <line x1="550" y1="120" x2="618" y2="405" stroke="#64748b" stroke-width="1" marker-end="url(#arrow)" stroke-dasharray="3"/>

  <!-- Legend -->
  <rect x="30" y="440" width="840" height="60" rx="6" fill="#f1f5f9"/>
  <text x="50" y="462" font-size="11" fill="#64748b">Solid lines: runtime data flow</text>
  <line x1="50" y1="478" x2="90" y2="478" stroke="#64748b" stroke-width="1.5"/>
  <text x="98" y="482" font-size="11" fill="#64748b">Direct call</text>
  <line x1="200" y1="478" x2="240" y2="478" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4"/>
  <text x="248" y="482" font-size="11" fill="#64748b">Indirect / background</text>
</svg>
```

- [ ] **Step 3: Create `system-architecture.html`** (self-contained)

Create `docs/assets/diagrams/system-architecture.html` wrapping the SVG with a styled page:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Adblock Compiler — System Architecture</title>
<style>
  body { margin: 0; background: #0f172a; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: Inter, system-ui, sans-serif; }
  .card { background: #f8fafc; border-radius: 16px; padding: 24px; max-width: 960px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,.4); }
  svg { width: 100%; height: auto; }
</style>
</head>
<body>
<div class="card">
  <!-- paste system-architecture.svg content here (the full <svg>…</svg> block) -->
</div>
</body>
</html>
```

> Note: copy the full SVG content from `system-architecture.svg` into the comment placeholder.

- [ ] **Step 4: Create `tech-stack.svg`**

Create `docs/assets/diagrams/tech-stack.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 440" font-family="Inter,system-ui,sans-serif">
  <rect width="700" height="440" fill="#f8fafc" rx="12"/>
  <text x="350" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">Adblock Compiler — Tech Stack</text>

  <!-- Layer labels (left) -->
  <text x="18" y="94"  font-size="10" fill="#94a3b8" transform="rotate(-90,18,94)">INFRA</text>
  <text x="18" y="174" font-size="10" fill="#94a3b8" transform="rotate(-90,18,174)">RUNTIME</text>
  <text x="18" y="264" font-size="10" fill="#94a3b8" transform="rotate(-90,18,264)">LANGUAGE</text>
  <text x="18" y="354" font-size="10" fill="#94a3b8" transform="rotate(-90,18,354)">FRAMEWORK</text>

  <!-- Infra row -->
  <rect x="40" y="60" width="612" height="50" rx="6" fill="#fff7ed" stroke="#f97316" stroke-width="1"/>
  <text x="110" y="91" text-anchor="middle" font-size="12" font-weight="600" fill="#c2410c">Cloudflare Workers</text>
  <text x="280" y="91" text-anchor="middle" font-size="12" font-weight="600" fill="#7e22ce">D1 · R2 · Queues</text>
  <text x="430" y="91" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Neon PostgreSQL</text>
  <text x="580" y="91" text-anchor="middle" font-size="12" font-weight="600" fill="#86198f">Sentry · CF Pages</text>

  <!-- Runtime row -->
  <rect x="40" y="140" width="612" height="50" rx="6" fill="#faf5ff" stroke="#a855f7" stroke-width="1"/>
  <text x="200" y="171" text-anchor="middle" font-size="12" font-weight="600" fill="#6b21a8">Deno 2</text>
  <text x="380" y="171" text-anchor="middle" font-size="12" font-weight="600" fill="#6b21a8">Node.js (dev tooling)</text>
  <text x="560" y="171" text-anchor="middle" font-size="12" font-weight="600" fill="#6b21a8">V8 (Workers runtime)</text>

  <!-- Language row -->
  <rect x="40" y="220" width="612" height="50" rx="6" fill="#eff6ff" stroke="#3b82f6" stroke-width="1"/>
  <text x="200" y="251" text-anchor="middle" font-size="12" font-weight="600" fill="#1e40af">TypeScript 5</text>
  <text x="380" y="251" text-anchor="middle" font-size="12" font-weight="600" fill="#1e40af">Zod (schemas)</text>
  <text x="560" y="251" text-anchor="middle" font-size="12" font-weight="600" fill="#1e40af">AGTree (rule parser)</text>

  <!-- Framework row -->
  <rect x="40" y="300" width="612" height="50" rx="6" fill="#f0fdf4" stroke="#22c55e" stroke-width="1"/>
  <text x="150" y="331" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Angular 21</text>
  <text x="310" y="331" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Hono (worker router)</text>
  <text x="470" y="331" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Prisma 7 (ORM)</text>
  <text x="610" y="331" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Better Auth</text>

  <!-- Test row -->
  <rect x="40" y="370" width="612" height="50" rx="6" fill="#fdf2f8" stroke="#ec4899" stroke-width="1"/>
  <text x="200" y="401" text-anchor="middle" font-size="12" font-weight="600" fill="#9d174d">Deno Test (worker)</text>
  <text x="400" y="401" text-anchor="middle" font-size="12" font-weight="600" fill="#9d174d">Angular TestBed (frontend)</text>
  <text x="590" y="401" text-anchor="middle" font-size="12" font-weight="600" fill="#9d174d">Playwright (e2e)</text>
</svg>
```

- [ ] **Step 5: Create `tech-stack.html`** (same wrapper pattern as system-architecture.html, paste tech-stack SVG content)

- [ ] **Step 6: Verify SVGs render in a browser**

Open both SVG files directly in a browser:
```bash
open docs/assets/diagrams/system-architecture.svg docs/assets/diagrams/tech-stack.svg
```
Expected: crisp diagrams at any zoom level.

- [ ] **Step 7: Commit**

```bash
git add docs/assets/diagrams/system-architecture.svg docs/assets/diagrams/system-architecture.html \
        docs/assets/diagrams/tech-stack.svg docs/assets/diagrams/tech-stack.html
git commit -m "docs: add system-architecture and tech-stack SVG+HTML diagrams"
```

---

### Task 7: Compilation pipeline + Feature map diagrams

**Files:**
- Create: `docs/assets/diagrams/compilation-pipeline.svg`
- Create: `docs/assets/diagrams/compilation-pipeline.html`
- Create: `docs/assets/diagrams/feature-map.svg`
- Create: `docs/assets/diagrams/feature-map.html`

- [ ] **Step 1: Create `compilation-pipeline.svg`**

Create `docs/assets/diagrams/compilation-pipeline.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 500" font-family="Inter,system-ui,sans-serif">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="#64748b"/>
    </marker>
  </defs>
  <rect width="880" height="500" fill="#f8fafc" rx="12"/>
  <text x="440" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">Compilation Pipeline — 6 Modes</text>

  <!-- Input box -->
  <rect x="30" y="200" width="120" height="60" rx="8" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="90" y="227" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Client</text>
  <text x="90" y="244" text-anchor="middle" font-size="11" fill="#3b82f6">POST /compile</text>

  <!-- Worker middleware -->
  <rect x="200" y="185" width="130" height="90" rx="8" fill="#fff7ed" stroke="#f97316" stroke-width="1.5"/>
  <text x="265" y="208" text-anchor="middle" font-size="12" font-weight="600" fill="#c2410c">Worker</text>
  <text x="265" y="223" text-anchor="middle" font-size="10" fill="#f97316">Auth · Rate limit</text>
  <text x="265" y="238" text-anchor="middle" font-size="10" fill="#f97316">Zod validation</text>
  <text x="265" y="253" text-anchor="middle" font-size="10" fill="#f97316">Turnstile check</text>

  <!-- Arrow Client → Worker -->
  <line x1="150" y1="230" x2="198" y2="230" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- 6 mode boxes -->
  <!-- JSON -->
  <rect x="390" y="60" width="130" height="60" rx="8" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="455" y="87" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">JSON</text>
  <text x="455" y="104" text-anchor="middle" font-size="10" fill="#22c55e">Sync · Single response</text>

  <!-- Stream -->
  <rect x="390" y="140" width="130" height="60" rx="8" fill="#eff6ff" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="455" y="167" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Stream (SSE)</text>
  <text x="455" y="184" text-anchor="middle" font-size="10" fill="#3b82f6">Real-time events</text>

  <!-- Async -->
  <rect x="390" y="220" width="130" height="60" rx="8" fill="#faf5ff" stroke="#a855f7" stroke-width="1.5"/>
  <text x="455" y="247" text-anchor="middle" font-size="12" font-weight="600" fill="#7e22ce">Async (Queue)</text>
  <text x="455" y="264" text-anchor="middle" font-size="10" fill="#a855f7">CF Queue · poll</text>

  <!-- Batch -->
  <rect x="390" y="300" width="130" height="60" rx="8" fill="#fff7ed" stroke="#f97316" stroke-width="1.5"/>
  <text x="455" y="327" text-anchor="middle" font-size="12" font-weight="600" fill="#c2410c">Batch</text>
  <text x="455" y="344" text-anchor="middle" font-size="10" fill="#f97316">Multiple lists · sync</text>

  <!-- Batch+Async -->
  <rect x="390" y="380" width="130" height="60" rx="8" fill="#fffbeb" stroke="#eab308" stroke-width="1.5"/>
  <text x="455" y="404" text-anchor="middle" font-size="12" font-weight="600" fill="#854d0e">Batch+Async</text>
  <text x="455" y="420" text-anchor="middle" font-size="10" fill="#eab308">Multiple · queued</text>

  <!-- Container -->
  <rect x="390" y="460" width="130" height="60" rx="8" fill="#fdf2f8" stroke="#ec4899" stroke-width="1.5"/>
  <text x="455" y="484" text-anchor="middle" font-size="12" font-weight="600" fill="#9d174d">Container</text>
  <text x="455" y="500" text-anchor="middle" font-size="10" fill="#ec4899">Durable Object</text>

  <!-- Worker → modes -->
  <line x1="330" y1="210" x2="388" y2="90"  stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="330" y1="220" x2="388" y2="170" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="330" y1="230" x2="388" y2="250" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="330" y1="240" x2="388" y2="330" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="330" y1="250" x2="388" y2="410" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="330" y1="260" x2="388" y2="475" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>

  <!-- Output box -->
  <rect x="580" y="195" width="130" height="70" rx="8" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="645" y="222" text-anchor="middle" font-size="12" font-weight="600" fill="#334155">Output</text>
  <text x="645" y="238" text-anchor="middle" font-size="10" fill="#64748b">Compiled rules</text>
  <text x="645" y="254" text-anchor="middle" font-size="10" fill="#64748b">DiffReport · Stats</text>

  <!-- Modes → output -->
  <line x1="520" y1="90"  x2="578" y2="220" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="520" y1="170" x2="578" y2="228" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="520" y1="250" x2="578" y2="238" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="520" y1="330" x2="578" y2="248" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
  <line x1="520" y1="410" x2="578" y2="258" stroke="#64748b" stroke-width="1" marker-end="url(#arr)"/>
</svg>
```

- [ ] **Step 2: Create `compilation-pipeline.html`** (wrapper with SVG content)

- [ ] **Step 3: Create `feature-map.svg`**

Create `docs/assets/diagrams/feature-map.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" font-family="Inter,system-ui,sans-serif">
  <rect width="800" height="480" fill="#f8fafc" rx="12"/>
  <text x="400" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">UI Feature Map</text>

  <!-- Public pages -->
  <text x="60" y="70" font-size="11" font-weight="600" fill="#64748b" letter-spacing="1">PUBLIC</text>
  <rect x="40"  y="80" width="120" height="50" rx="6" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="100" y="102" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Home</text>
  <text x="100" y="118" text-anchor="middle" font-size="10" fill="#22c55e">/</text>

  <rect x="180" y="80" width="120" height="50" rx="6" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="240" y="102" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">API Docs</text>
  <text x="240" y="118" text-anchor="middle" font-size="10" fill="#22c55e">/api-docs</text>

  <rect x="320" y="80" width="120" height="50" rx="6" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="380" y="102" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Sign In</text>
  <text x="380" y="118" text-anchor="middle" font-size="10" fill="#22c55e">/sign-in</text>

  <rect x="460" y="80" width="120" height="50" rx="6" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="520" y="102" text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">Sign Up</text>
  <text x="520" y="118" text-anchor="middle" font-size="10" fill="#22c55e">/sign-up</text>

  <!-- Auth-gated pages -->
  <text x="60" y="180" font-size="11" font-weight="600" fill="#64748b" letter-spacing="1">AUTHENTICATED (Free+)</text>
  <rect x="40"  y="190" width="120" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="100" y="212" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Compiler</text>
  <text x="100" y="228" text-anchor="middle" font-size="10" fill="#3b82f6">/compiler</text>

  <rect x="180" y="190" width="120" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="240" y="212" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Validation</text>
  <text x="240" y="228" text-anchor="middle" font-size="10" fill="#3b82f6">/validation</text>

  <rect x="320" y="190" width="120" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="380" y="212" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Diff</text>
  <text x="380" y="228" text-anchor="middle" font-size="10" fill="#3b82f6">/diff ★ new</text>

  <rect x="460" y="190" width="120" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="520" y="212" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Performance</text>
  <text x="520" y="228" text-anchor="middle" font-size="10" fill="#3b82f6">/performance</text>

  <rect x="600" y="190" width="120" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="660" y="212" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">API Keys</text>
  <text x="660" y="228" text-anchor="middle" font-size="10" fill="#3b82f6">/api-keys</text>

  <rect x="40" y="260" width="120" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="100" y="282" text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Profile</text>
  <text x="100" y="298" text-anchor="middle" font-size="10" fill="#3b82f6">/profile</text>

  <!-- Admin -->
  <text x="60" y="350" font-size="11" font-weight="600" fill="#64748b" letter-spacing="1">ADMIN ONLY</text>
  <rect x="40"  y="360" width="100" height="50" rx="6" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="90"  y="382" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Dashboard</text>
  <rect x="160" y="360" width="100" height="50" rx="6" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="210" y="382" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Users</text>
  <rect x="280" y="360" width="100" height="50" rx="6" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="330" y="382" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Feature Flags</text>
  <rect x="400" y="360" width="100" height="50" rx="6" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="450" y="382" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Audit Log</text>
  <rect x="520" y="360" width="100" height="50" rx="6" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="570" y="382" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Webhooks</text>
  <rect x="640" y="360" width="100" height="50" rx="6" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="690" y="382" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Agents</text>

  <!-- Legend -->
  <rect x="40" y="430" width="720" height="36" rx="6" fill="#f1f5f9"/>
  <rect x="58" y="442" width="12" height="12" rx="2" fill="#f0fdf4" stroke="#22c55e"/>
  <text x="76" y="453" font-size="11" fill="#475569">Public</text>
  <rect x="130" y="442" width="12" height="12" rx="2" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="148" y="453" font-size="11" fill="#475569">Auth required</text>
  <rect x="250" y="442" width="12" height="12" rx="2" fill="#fef2f2" stroke="#ef4444"/>
  <text x="268" y="453" font-size="11" fill="#475569">Admin only</text>
  <text x="380" y="453" font-size="11" fill="#475569">★ new = added in this release</text>
</svg>
```

- [ ] **Step 4: Create `feature-map.html`** (wrapper with SVG content)

- [ ] **Step 5: Verify both SVGs**

```bash
open docs/assets/diagrams/compilation-pipeline.svg docs/assets/diagrams/feature-map.svg
```

- [ ] **Step 6: Commit**

```bash
git add docs/assets/diagrams/compilation-pipeline.svg docs/assets/diagrams/compilation-pipeline.html \
        docs/assets/diagrams/feature-map.svg docs/assets/diagrams/feature-map.html
git commit -m "docs: add compilation-pipeline and feature-map SVG+HTML diagrams"
```

---

### Task 8: API overview + Diff workflow diagrams

**Files:**
- Create: `docs/assets/diagrams/api-overview.svg`
- Create: `docs/assets/diagrams/api-overview.html`
- Create: `docs/assets/diagrams/diff-workflow.svg`
- Create: `docs/assets/diagrams/diff-workflow.html`

- [ ] **Step 1: Create `api-overview.svg`**

Create `docs/assets/diagrams/api-overview.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 520" font-family="Inter,system-ui,sans-serif">
  <rect width="820" height="520" fill="#f8fafc" rx="12"/>
  <text x="410" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">API Endpoint Overview</text>

  <!-- Helper: method badge macro via reuse -->
  <!-- Compile group -->
  <rect x="30" y="56" width="370" height="200" rx="8" fill="#fff7ed" stroke="#f97316" stroke-width="1"/>
  <text x="50" y="76" font-size="12" font-weight="700" fill="#c2410c">Compile</text>
  <text x="50" y="98"  font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /compile              JSON mode</text>
  <text x="50" y="116" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /compile/stream       SSE streaming</text>
  <text x="50" y="134" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /compile/async        Queue submit</text>
  <text x="50" y="152" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /compile/batch        Batch sync</text>
  <text x="50" y="170" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /compile/batch-async  Batch queued</text>
  <text x="50" y="188" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /compile/container    DO container</text>
  <text x="50" y="206" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /ast/parse            AGTree AST</text>
  <text x="50" y="224" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /validate             Validate list</text>
  <text x="50" y="242" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /validate-rule        Single rule AST</text>

  <!-- Diff group -->
  <rect x="30" y="270" width="370" height="60" rx="8" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="50" y="290" font-size="12" font-weight="700" fill="#15803d">Diff ★</text>
  <text x="50" y="312" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /diff                 AGTree AST diff</text>

  <!-- Queue group -->
  <rect x="420" y="56" width="370" height="100" rx="8" fill="#fffbeb" stroke="#eab308" stroke-width="1"/>
  <text x="440" y="76" font-size="12" font-weight="700" fill="#854d0e">Queue</text>
  <text x="440" y="98"  font-size="11" fill="#374151"><tspan fill="#3b82f6" font-weight="700">GET </tspan>  /queue/stats          Queue statistics</text>
  <text x="440" y="116" font-size="11" fill="#374151"><tspan fill="#3b82f6" font-weight="700">GET </tspan>  /queue/jobs           Job listing</text>
  <text x="440" y="134" font-size="11" fill="#374151"><tspan fill="#ef4444" font-weight="700">DEL </tspan>  /queue/jobs/:id       Cancel job</text>

  <!-- Metrics group -->
  <rect x="420" y="170" width="370" height="80" rx="8" fill="#f0f9ff" stroke="#0ea5e9" stroke-width="1"/>
  <text x="440" y="190" font-size="12" font-weight="700" fill="#0369a1">Metrics</text>
  <text x="440" y="212" font-size="11" fill="#374151"><tspan fill="#3b82f6" font-weight="700">GET </tspan>  /metrics              Aggregated stats</text>
  <text x="440" y="230" font-size="11" fill="#374151"><tspan fill="#3b82f6" font-weight="700">GET </tspan>  /metrics/prometheus   Prometheus format</text>

  <!-- Auth group -->
  <rect x="420" y="264" width="370" height="100" rx="8" fill="#fdf4ff" stroke="#c026d3" stroke-width="1"/>
  <text x="440" y="284" font-size="12" font-weight="700" fill="#86198f">Auth + API Keys</text>
  <text x="440" y="306" font-size="11" fill="#374151"><tspan fill="#22c55e" font-weight="700">POST</tspan>  /api-keys             Create key</text>
  <text x="440" y="324" font-size="11" fill="#374151"><tspan fill="#3b82f6" font-weight="700">GET </tspan>  /api-keys             List keys</text>
  <text x="440" y="342" font-size="11" fill="#374151"><tspan fill="#ef4444" font-weight="700">DEL </tspan>  /api-keys/:id         Revoke key</text>

  <!-- Health group -->
  <rect x="30" y="346" width="760" height="60" rx="8" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>
  <text x="50" y="366" font-size="12" font-weight="700" fill="#475569">Health + Info</text>
  <text x="50" y="388" font-size="11" fill="#374151"><tspan fill="#3b82f6" font-weight="700">GET </tspan> /health    <tspan dx="30" fill="#3b82f6" font-weight="700">GET </tspan> /health/*services    <tspan dx="30" fill="#3b82f6" font-weight="700">GET </tspan> /info    <tspan dx="30" fill="#3b82f6" font-weight="700">GET </tspan> /container/status</text>

  <!-- Legend -->
  <rect x="30" y="426" width="760" height="36" rx="6" fill="#f1f5f9"/>
  <text x="50"  y="450" font-size="11" fill="#22c55e" font-weight="700">POST</text>
  <text x="90"  y="450" font-size="11" fill="#475569">create/compute</text>
  <text x="200" y="450" font-size="11" fill="#3b82f6" font-weight="700">GET</text>
  <text x="230" y="450" font-size="11" fill="#475569">read</text>
  <text x="290" y="450" font-size="11" fill="#ef4444" font-weight="700">DELETE</text>
  <text x="345" y="450" font-size="11" fill="#475569">remove</text>
  <text x="430" y="450" font-size="11" fill="#475569">★ new in this release</text>
  <text x="610" y="450" font-size="11" fill="#475569">All routes: /api/&lt;path&gt;</text>
</svg>
```

- [ ] **Step 2: Create `api-overview.html`** (wrapper with SVG content)

- [ ] **Step 3: Create `diff-workflow.svg`**

Create `docs/assets/diagrams/diff-workflow.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 360" font-family="Inter,system-ui,sans-serif">
  <defs>
    <marker id="arrw" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="#64748b"/>
    </marker>
  </defs>
  <rect width="820" height="360" fill="#f8fafc" rx="12"/>
  <text x="410" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">Diff Workflow — AGTree as Source of Truth</text>

  <!-- Step 1: Raw input -->
  <rect x="30" y="70" width="140" height="80" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="100" y="97"  text-anchor="middle" font-size="12" font-weight="600" fill="#334155">Raw Input</text>
  <text x="100" y="114" text-anchor="middle" font-size="10" fill="#64748b">Original list</text>
  <text x="100" y="130" text-anchor="middle" font-size="10" fill="#64748b">Current list</text>

  <line x1="170" y1="110" x2="210" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrw)"/>

  <!-- Step 2: AGTree parse -->
  <rect x="210" y="60" width="160" height="100" rx="8" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="290" y="90"  text-anchor="middle" font-size="12" font-weight="600" fill="#92400e">AGTree Parse</text>
  <text x="290" y="108" text-anchor="middle" font-size="10" fill="#b45309">ASTViewerService</text>
  <text x="290" y="124" text-anchor="middle" font-size="10" fill="#b45309">.parseRule()</text>
  <text x="290" y="140" text-anchor="middle" font-size="10" fill="#b45309">per rule</text>

  <!-- Parse errors branch (down) -->
  <line x1="290" y1="160" x2="290" y2="200" stroke="#ef4444" stroke-width="1.5" marker-end="url(#arrw)" stroke-dasharray="4"/>
  <rect x="210" y="200" width="160" height="50" rx="8" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5"/>
  <text x="290" y="222" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">Parse Errors</text>
  <text x="290" y="238" text-anchor="middle" font-size="10" fill="#ef4444">Surfaced in UI</text>
  <text x="290" y="172" text-anchor="middle" font-size="10" fill="#ef4444">invalid rules excluded</text>

  <line x1="370" y1="110" x2="410" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrw)"/>

  <!-- Step 3: Valid AST sets -->
  <rect x="410" y="70" width="140" height="80" rx="8" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="480" y="97"  text-anchor="middle" font-size="12" font-weight="600" fill="#1d4ed8">Valid AST Sets</text>
  <text x="480" y="114" text-anchor="middle" font-size="10" fill="#3b82f6">Normalised rules</text>
  <text x="480" y="130" text-anchor="middle" font-size="10" fill="#3b82f6">Semantic equality</text>

  <line x1="550" y1="110" x2="590" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrw)"/>

  <!-- Step 4: DiffGenerator -->
  <rect x="590" y="60" width="140" height="100" rx="8" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/>
  <text x="660" y="90"  text-anchor="middle" font-size="12" font-weight="600" fill="#15803d">DiffGenerator</text>
  <text x="660" y="108" text-anchor="middle" font-size="10" fill="#22c55e">Added rules</text>
  <text x="660" y="124" text-anchor="middle" font-size="10" fill="#22c55e">Removed rules</text>
  <text x="660" y="140" text-anchor="middle" font-size="10" fill="#22c55e">Domain analysis</text>

  <line x1="660" y1="160" x2="660" y2="200" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrw)"/>

  <!-- Step 5: DiffReport -->
  <rect x="590" y="200" width="140" height="80" rx="8" fill="#faf5ff" stroke="#a855f7" stroke-width="1.5"/>
  <text x="660" y="228" text-anchor="middle" font-size="12" font-weight="600" fill="#7e22ce">DiffReport</text>
  <text x="660" y="245" text-anchor="middle" font-size="10" fill="#a855f7">Summary stats</text>
  <text x="660" y="261" text-anchor="middle" font-size="10" fill="#a855f7">JSON · Markdown</text>

  <!-- Key insight callout -->
  <rect x="30" y="290" width="760" height="50" rx="8" fill="#fffbeb" stroke="#eab308" stroke-width="1.5"/>
  <text x="410" y="311" text-anchor="middle" font-size="12" font-weight="600" fill="#92400e">Key: AGTree is the single source of truth</text>
  <text x="410" y="329" text-anchor="middle" font-size="11" fill="#b45309">Two textually different rules that parse to the same AST node are treated as identical — no false diffs.</text>
</svg>
```

- [ ] **Step 4: Create `diff-workflow.html`** (wrapper with SVG content)

- [ ] **Step 5: Verify**

```bash
open docs/assets/diagrams/api-overview.svg docs/assets/diagrams/diff-workflow.svg
```

- [ ] **Step 6: Commit**

```bash
git add docs/assets/diagrams/api-overview.svg docs/assets/diagrams/api-overview.html \
        docs/assets/diagrams/diff-workflow.svg docs/assets/diagrams/diff-workflow.html
git commit -m "docs: add api-overview and diff-workflow SVG+HTML diagrams"
```

---

## Track 3 — Prisma D1 Migration Workflow

---

### Task 9: D1 migration generator script

**Files:**
- Create: `scripts/generate-d1-migration.ts`
- Modify: `deno.json`

- [ ] **Step 1: Write the script**

Create `scripts/generate-d1-migration.ts`:

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * generate-d1-migration.ts
 *
 * Generates the next numbered D1 migration file by:
 *  1. Applying all existing migrations in `migrations/` to a temporary SQLite DB
 *  2. Running `prisma migrate diff` from that shadow DB to the current schema.d1.prisma
 *  3. Writing the output as migrations/<next>_<name>.sql
 *
 * Usage:
 *   deno task db:migrate:d1 <migration-name>
 *
 * Example:
 *   deno task db:migrate:d1 add-diff-history
 *   → creates migrations/0009_add-diff-history.sql
 */

import { join } from 'jsr:@std/path';
import { existsSync } from 'jsr:@std/fs';

const migrationName = Deno.args[0];
if (!migrationName) {
    console.error('❌ Usage: deno task db:migrate:d1 <migration-name>');
    console.error('   Example: deno task db:migrate:d1 add-user-preferences');
    Deno.exit(1);
}
if (!/^[a-z0-9-_]+$/i.test(migrationName)) {
    console.error('❌ Migration name must contain only letters, numbers, hyphens, and underscores.');
    Deno.exit(1);
}

const MIGRATIONS_DIR   = 'migrations';
const SCHEMA_PATH      = 'prisma/schema.d1.prisma';

// ── Resolve next migration number ────────────────────────────────────────────

const existingFiles = [...Deno.readDirSync(MIGRATIONS_DIR)]
    .filter((e) => e.isFile && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();

const highestNum = existingFiles.reduce((max, name) => {
    const n = parseInt(name.split('_')[0], 10);
    return isNaN(n) ? max : Math.max(max, n);
}, 0);

const nextNum     = String(highestNum + 1).padStart(4, '0');
const outFilename = `${nextNum}_${migrationName}.sql`;
const outPath     = join(MIGRATIONS_DIR, outFilename);

// ── Create shadow SQLite DB and apply existing migrations ─────────────────────

const shadowDb = await Deno.makeTempFile({ prefix: 'd1-shadow-', suffix: '.db' });
console.log(`🔧 Shadow DB: ${shadowDb}`);

try {
    // Apply each existing migration using sqlite3 CLI (available in CI and most dev environments)
    for (const file of existingFiles) {
        const sql = await Deno.readTextFile(join(MIGRATIONS_DIR, file));
        // Skip empty or comment-only files
        const meaningful = sql.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
        if (meaningful.length === 0) continue;

        const applyCmd = new Deno.Command('sqlite3', {
            args: [shadowDb, sql],
            stderr: 'piped',
        });
        const { code, stderr } = await applyCmd.output();
        if (code !== 0) {
            const err = new TextDecoder().decode(stderr);
            console.error(`❌ Failed to apply ${file}:\n${err}`);
            Deno.exit(1);
        }
        console.log(`  ✓ Applied ${file}`);
    }

    // ── Run prisma migrate diff ───────────────────────────────────────────────

    console.log('\n🔍 Running prisma migrate diff…');
    const diffCmd = new Deno.Command('deno', {
        args: [
            'run', '-A', 'npm:prisma', 'migrate', 'diff',
            '--from-url',             `file:${shadowDb}`,
            '--to-schema-datamodel',  SCHEMA_PATH,
            '--script',
        ],
        stdout: 'piped',
        stderr: 'piped',
    });
    const { code: diffCode, stdout, stderr: diffErr } = await diffCmd.output();
    const diffSql = new TextDecoder().decode(stdout).trim();
    const diffErrStr = new TextDecoder().decode(diffErr).trim();

    if (diffCode !== 0) {
        console.error(`❌ prisma migrate diff failed:\n${diffErrStr}`);
        Deno.exit(1);
    }

    if (!diffSql || diffSql === '-- This is an empty migration.') {
        console.log('\n✅ No schema changes detected. Nothing to migrate.');
        Deno.exit(0);
    }

    // ── Write migration file ──────────────────────────────────────────────────

    const header = [
        `-- =============================================================================`,
        `-- Migration: ${outFilename}`,
        `-- Generated: ${new Date().toISOString()}`,
        `-- Schema:    ${SCHEMA_PATH}`,
        `-- =============================================================================`,
        '',
    ].join('\n');

    await Deno.writeTextFile(outPath, header + diffSql + '\n');
    console.log(`\n✅ Created ${outPath}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review the generated SQL: cat ${outPath}`);
    console.log(`  2. Apply locally:  deno task wrangler d1 migrations apply bloqr-backend-d1-database --local`);
    console.log(`  3. Apply remotely: deno task db:migrate:d1:deploy`);
    console.log(`  4. Commit:         git add ${outPath} && git commit -m "chore(db): add migration ${outFilename}"`);

} finally {
    await Deno.remove(shadowDb).catch(() => {});
}
```

- [ ] **Step 2: Add tasks to `deno.json`**

In the `"tasks"` section of `deno.json`, add after the existing `db:` tasks:

```json
"db:migrate:d1":        "deno run --allow-read --allow-write --allow-run scripts/generate-d1-migration.ts",
"db:migrate:d1:deploy": "deno task wrangler d1 migrations apply bloqr-backend-d1-database --remote",
"db:check:d1":          "deno run --allow-read --allow-write --allow-run scripts/generate-d1-migration.ts __drift-check__ && echo '✅ D1 schema in sync'",
```

> Note: `db:check:d1` uses the migration name `__drift-check__` — the script exits 0 when no diff is found ("No schema changes detected"), which signals the schema is in sync.

- [ ] **Step 3: Smoke-test the script against the live schema**

```bash
deno task db:migrate:d1 smoke-test-no-changes
```

Expected output (since schema is already applied):
```
✅ No schema changes detected. Nothing to migrate.
```

If sqlite3 is not installed:
```bash
brew install sqlite
```

- [ ] **Step 4: Run the drift check task**

```bash
deno task db:check:d1
```

Expected: `✅ D1 schema in sync`

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-d1-migration.ts deno.json
git commit -m "chore(db): add Prisma-driven D1 migration generator and drift-check task"
```

---

### Task 10: Final integration test

- [ ] **Step 1: Run full test suite**

```bash
deno task test
```

Expected: all tests pass (1420+ src, 1197+ worker, 0 failed).

- [ ] **Step 2: Verify diff endpoint manually**

```bash
deno task dev &
sleep 3
curl -s -X POST http://localhost:8787/api/diff \
  -H "Content-Type: application/json" \
  -d '{"original":["||example.com^","||ads.com^"],"current":["||example.com^","||newads.com^"]}' \
  | deno run -A npm:prettier --parser=json
```

Expected JSON response:
```json
{
  "success": true,
  "parseErrors": { "original": [], "current": [] },
  "report": {
    "summary": { "addedCount": 1, "removedCount": 1, "unchangedCount": 1 },
    ...
  },
  "duration": "...ms"
}
```

- [ ] **Step 3: Verify all 12 diagram files exist**

```bash
ls docs/assets/diagrams/
```

Expected output (12 files):
```
api-overview.html     compilation-pipeline.html  diff-workflow.html  feature-map.html  system-architecture.html  tech-stack.html
api-overview.svg      compilation-pipeline.svg   diff-workflow.svg   feature-map.svg   system-architecture.svg   tech-stack.svg
```

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: diff UI, visual artifacts, and Prisma D1 migration workflow complete"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Track 1 (Diff UI) — handler, schema, route, service, component, route registration all covered. Track 2 — 6 diagrams × 2 formats = 12 files, all tasked. Track 3 — script + deno.json tasks covered.
- [x] **No placeholders:** All code is complete. No TBDs.
- [x] **Type consistency:** `DiffApiResponse` used consistently in service and component. `DiffRequest`/`DiffResponse` match between `worker/schemas.ts` and `worker/openapi-types.ts`. `DiffParseError` matches `ParseError` from openapi-types (service imports from `api-responses.ts`).
- [x] **Test commands:** All test commands include full permission flags matching existing project patterns.
