/**
 * Tests for SourceHealthMonitor
 */

import { assertEquals } from '@std/assert';
import { HealthStatus, SourceHealthMonitor } from './SourceHealthMonitor.ts';
import { IStorageAdapter } from './IStorageAdapter.ts';
import { silentLogger } from '../utils/index.ts';

/**
 * Mock storage adapter for testing
 */
class MockStorageAdapter implements IStorageAdapter {
    private data = new Map<string, { data: unknown; expiresAt?: number }>();
    private _isOpen = true;

    async open(): Promise<void> {
        this._isOpen = true;
    }

    async close(): Promise<void> {
        this._isOpen = false;
    }

    isOpen(): boolean {
        return this._isOpen;
    }

    async get<T>(key: string[]): Promise<{ data: T; expiresAt?: number } | null> {
        const keyStr = key.join('/');
        const entry = this.data.get(keyStr);
        if (!entry) return null;

        // Check if expired
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.data.delete(keyStr);
            return null;
        }

        return entry as { data: T; expiresAt?: number };
    }

    async set(key: string[], value: unknown, ttlMs?: number): Promise<boolean> {
        const keyStr = key.join('/');
        const entry: { data: unknown; expiresAt?: number } = { data: value };
        if (ttlMs) {
            entry.expiresAt = Date.now() + ttlMs;
        }
        this.data.set(keyStr, entry);
        return true;
    }

    async delete(key: string[]): Promise<boolean> {
        const keyStr = key.join('/');
        return this.data.delete(keyStr);
    }

    async list<T>(options?: { prefix?: string[]; limit?: number; reverse?: boolean }): Promise<
        Array<{ key: string[]; value: { data: T; expiresAt?: number } }>
    > {
        const prefixStr = options?.prefix ? options.prefix.join('/') : '';
        const results: Array<{ key: string[]; value: { data: T; expiresAt?: number } }> = [];

        for (const [keyStr, entry] of this.data.entries()) {
            if (keyStr.startsWith(prefixStr)) {
                // Skip expired entries
                if (entry.expiresAt && Date.now() > entry.expiresAt) {
                    continue;
                }
                results.push({
                    key: keyStr.split('/'),
                    value: entry as { data: T; expiresAt?: number },
                });
            }
        }

        if (options?.reverse) {
            results.reverse();
        }

        if (options?.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    async clearExpired(): Promise<number> {
        const now = Date.now();
        let count = 0;
        for (const [key, entry] of this.data.entries()) {
            if (entry.expiresAt && now > entry.expiresAt) {
                this.data.delete(key);
                count++;
            }
        }
        return count;
    }

    async getStats(): Promise<{
        totalEntries: number;
        expiredEntries: number;
        storageSize: number;
    }> {
        const now = Date.now();
        let expiredEntries = 0;
        for (const entry of this.data.values()) {
            if (entry.expiresAt && now > entry.expiresAt) {
                expiredEntries++;
            }
        }
        return {
            totalEntries: this.data.size,
            expiredEntries,
            storageSize: 0,
        };
    }

    async cacheFilterList(
        source: string,
        content: string[],
        hash: string,
        etag?: string,
        ttlMs?: number,
    ): Promise<boolean> {
        const entry = {
            content,
            hash,
            etag,
            timestamp: Date.now(),
        };
        return await this.set(['cache', 'filters', source], entry, ttlMs);
    }

    async getCachedFilterList(source: string): Promise<{
        data: { content: string[]; hash: string; etag?: string; timestamp: number };
    } | null> {
        return await this.get<{ content: string[]; hash: string; etag?: string; timestamp: number }>([
            'cache',
            'filters',
            source,
        ]);
    }

    async storeCompilationMetadata(_metadata: unknown): Promise<boolean> {
        return true;
    }

    async getCompilationHistory(_configName: string, _limit?: number): Promise<unknown[]> {
        return [];
    }

    async clearCache(): Promise<number> {
        const entries = await this.list({ prefix: ['cache'] });
        let count = 0;
        for (const entry of entries) {
            if (await this.delete(entry.key)) {
                count++;
            }
        }
        return count;
    }
}

Deno.test('SourceHealthMonitor - constructor', () => {
    const storage = new MockStorageAdapter();
    const monitor = new SourceHealthMonitor(storage, silentLogger);

    assertEquals(monitor !== null, true);
});

Deno.test('SourceHealthMonitor - recordAttempt', async (t) => {
    await t.step('should record successful attempt', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100, { ruleCount: 50 });

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.totalAttempts, 1);
        assertEquals(metrics?.successfulAttempts, 1);
        assertEquals(metrics?.failedAttempts, 0);
    });

    await t.step('should record failed attempt', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', false, 50, { error: 'Network error' });

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.totalAttempts, 1);
        assertEquals(metrics?.successfulAttempts, 0);
        assertEquals(metrics?.failedAttempts, 1);
    });

    await t.step('should record multiple attempts', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source1', false, 50);
        await monitor.recordAttempt('source1', true, 120);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.totalAttempts, 3);
        assertEquals(metrics?.successfulAttempts, 2);
        assertEquals(metrics?.failedAttempts, 1);
    });

    await t.step('should limit recent attempts to max', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger, 5);

        // Record 10 attempts
        for (let i = 0; i < 10; i++) {
            await monitor.recordAttempt('source1', true, 100);
        }

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.recentAttempts.length, 5);
    });
});

Deno.test('SourceHealthMonitor - getHealthMetrics', async (t) => {
    await t.step('should calculate success rate correctly', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source1', false, 100);
        await monitor.recordAttempt('source1', true, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.successRate, 0.75); // 3 out of 4
    });

    await t.step('should calculate average duration', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source1', true, 200);
        await monitor.recordAttempt('source1', true, 300);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.averageDuration, 200); // (100 + 200 + 300) / 3
    });

    await t.step('should track consecutive failures', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source1', false, 100);
        await monitor.recordAttempt('source1', false, 100);
        await monitor.recordAttempt('source1', false, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.consecutiveFailures, 3);
        assertEquals(metrics?.isCurrentlyFailing, true);
    });

    await t.step('should reset consecutive failures on success', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', false, 100);
        await monitor.recordAttempt('source1', false, 100);
        await monitor.recordAttempt('source1', true, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.consecutiveFailures, 0);
        assertEquals(metrics?.isCurrentlyFailing, false);
    });

    await t.step('should return null for unknown source', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        const metrics = await monitor.getHealthMetrics('nonexistent');

        assertEquals(metrics, null);
    });

    await t.step('should calculate average rule count', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100, { ruleCount: 100 });
        await monitor.recordAttempt('source1', true, 100, { ruleCount: 200 });

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.averageRuleCount, 150);
    });
});

Deno.test('SourceHealthMonitor - calculateHealthStatus', async (t) => {
    await t.step('should return Healthy for high success rate', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        // 90% success rate
        for (let i = 0; i < 9; i++) {
            await monitor.recordAttempt('source1', true, 100);
        }
        await monitor.recordAttempt('source1', false, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.status, HealthStatus.Healthy);
    });

    await t.step('should return Degraded for medium success rate', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        // 70% success rate
        for (let i = 0; i < 7; i++) {
            await monitor.recordAttempt('source1', true, 100);
        }
        for (let i = 0; i < 3; i++) {
            await monitor.recordAttempt('source1', false, 100);
        }

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.status, HealthStatus.Degraded);
    });

    await t.step('should return Unhealthy for low success rate', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        // 30% success rate
        for (let i = 0; i < 3; i++) {
            await monitor.recordAttempt('source1', true, 100);
        }
        for (let i = 0; i < 7; i++) {
            await monitor.recordAttempt('source1', false, 100);
        }

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.status, HealthStatus.Unhealthy);
    });

    await t.step('should return Unknown for no attempts', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.status, HealthStatus.Unknown);
    });
});

Deno.test('SourceHealthMonitor - getAllSources', async (t) => {
    await t.step('should return metrics for all sources', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source2', true, 100);
        await monitor.recordAttempt('source3', false, 100);

        const allMetrics = await monitor.getAllSources();

        assertEquals(allMetrics.length, 3);
        assertEquals(allMetrics.some((m) => m.source === 'source1'), true);
        assertEquals(allMetrics.some((m) => m.source === 'source2'), true);
        assertEquals(allMetrics.some((m) => m.source === 'source3'), true);
    });

    await t.step('should return empty array when no metrics', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        const allMetrics = await monitor.getAllSources();

        assertEquals(allMetrics.length, 0);
    });
});

Deno.test('SourceHealthMonitor - generateHealthReport', async (t) => {
    await t.step('should generate health report', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source2', false, 100);

        const report = await monitor.generateHealthReport();

        assertEquals(typeof report.totalSources, 'number');
        assertEquals(typeof report.healthySources, 'number');
        assertEquals(typeof report.degradedSources, 'number');
        assertEquals(typeof report.unhealthySources, 'number');
    });

    await t.step('should count sources by status', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        // Healthy source
        for (let i = 0; i < 10; i++) {
            await monitor.recordAttempt('healthy', true, 100);
        }

        // Unhealthy source
        for (let i = 0; i < 10; i++) {
            await monitor.recordAttempt('unhealthy', false, 100);
        }

        const report = await monitor.generateHealthReport();

        assertEquals(report.totalSources, 2);
        assertEquals(report.healthySources, 1);
        assertEquals(report.unhealthySources, 1);
    });
});

Deno.test('SourceHealthMonitor - clearMetrics', async (t) => {
    await t.step('should clear metrics for a source', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.clearSourceHealth('source1');

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics, null);
    });

    await t.step('should not affect other sources', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        await monitor.recordAttempt('source2', true, 100);

        await monitor.clearSourceHealth('source1');

        const metrics2 = await monitor.getHealthMetrics('source2');
        assertEquals(metrics2?.totalAttempts, 1);
    });
});

Deno.test('SourceHealthMonitor - edge cases', async (t) => {
    await t.step('should handle zero duration', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 0);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.averageDuration, 0);
    });

    await t.step('should handle very long durations', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 999999);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.averageDuration, 999999);
    });

    await t.step('should handle rapid consecutive attempts', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        for (let i = 0; i < 100; i++) {
            await monitor.recordAttempt('source1', i % 2 === 0, 100);
        }

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(metrics?.totalAttempts, 100);
        assertEquals(metrics?.successRate, 0.5);
    });

    await t.step('should handle special characters in source names', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        const sourceName = 'https://example.com/filter?param=value&other=123';

        await monitor.recordAttempt(sourceName, true, 100);

        const metrics = await monitor.getHealthMetrics(sourceName);

        assertEquals(metrics?.source, sourceName);
    });
});

Deno.test('SourceHealthMonitor - timestamps', async (t) => {
    await t.step('should track last attempt timestamp', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(typeof metrics?.lastAttempt, 'number');
        assertEquals((metrics?.lastAttempt ?? 0) > 0, true);
    });

    await t.step('should track last success timestamp', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(typeof metrics?.lastSuccess, 'number');
    });

    await t.step('should track last failure timestamp', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', false, 100);

        const metrics = await monitor.getHealthMetrics('source1');

        assertEquals(typeof metrics?.lastFailure, 'number');
    });

    await t.step('should update last attempt on each record', async () => {
        const storage = new MockStorageAdapter();
        const monitor = new SourceHealthMonitor(storage, silentLogger);

        await monitor.recordAttempt('source1', true, 100);
        const first = await monitor.getHealthMetrics('source1');

        await new Promise((resolve) => setTimeout(resolve, 10));

        await monitor.recordAttempt('source1', true, 100);
        const second = await monitor.getHealthMetrics('source1');

        assertEquals((second?.lastAttempt ?? 0) > (first?.lastAttempt ?? 0), true);
    });
});
