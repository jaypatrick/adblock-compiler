/**
 * Tests for the Clerk Auth Provider.
 *
 * The ClerkAuthProvider.verifyToken() makes an outbound JWKS fetch which we
 * cannot easily mock in unit tests, so we focus on the testable logic that is
 * exported for unit testing:
 *
 *   - resolveTierFromMetadata: correct tier mapping, fallback to Free
 *
 * @see worker/middleware/clerk-auth-provider.ts
 */

import { assertEquals } from '@std/assert';
import { resolveTierFromMetadata } from './clerk-auth-provider.ts';
import type { IClerkPublicMetadata } from '../types.ts';
import { UserTier } from '../types.ts';

// ============================================================================
// resolveTierFromMetadata
// ============================================================================

Deno.test('resolveTierFromMetadata - returns Free when metadata is undefined', () => {
    assertEquals(resolveTierFromMetadata(undefined), UserTier.Free);
});

Deno.test('resolveTierFromMetadata - returns Free when tier is absent', () => {
    const meta = {} as IClerkPublicMetadata;
    assertEquals(resolveTierFromMetadata(meta), UserTier.Free);
});

Deno.test('resolveTierFromMetadata - returns Free tier', () => {
    const meta = { tier: UserTier.Free } as IClerkPublicMetadata;
    assertEquals(resolveTierFromMetadata(meta), UserTier.Free);
});

Deno.test('resolveTierFromMetadata - returns Pro tier', () => {
    const meta = { tier: UserTier.Pro } as IClerkPublicMetadata;
    assertEquals(resolveTierFromMetadata(meta), UserTier.Pro);
});

Deno.test('resolveTierFromMetadata - returns Admin tier', () => {
    const meta = { tier: UserTier.Admin } as IClerkPublicMetadata;
    assertEquals(resolveTierFromMetadata(meta), UserTier.Admin);
});

Deno.test('resolveTierFromMetadata - returns Free for unknown tier string', () => {
    const meta = { tier: 'superduper' as UserTier } as IClerkPublicMetadata;
    assertEquals(resolveTierFromMetadata(meta), UserTier.Free);
});

Deno.test('resolveTierFromMetadata - returns Free for empty string tier', () => {
    const meta = { tier: '' as UserTier } as IClerkPublicMetadata;
    assertEquals(resolveTierFromMetadata(meta), UserTier.Free);
});
