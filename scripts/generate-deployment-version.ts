#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * Generate deployment version before deploying to Cloudflare Workers
 *
 * This script:
 * 1. Reads the current version from deno.json
 * 2. Queries D1 for the latest build number
 * 3. Generates the next build number
 * 4. Creates a full version string (e.g., 0.11.3+build.42)
 * 5. Outputs version info for CI/CD to use
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-env scripts/generate-deployment-version.ts
 *
 * Environment variables:
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN - Cloudflare API token
 *   D1_DATABASE_ID - D1 database ID (optional, defaults to value in wrangler.toml)
 */

import { formatFullVersion } from '../src/deployment/version.ts';
import { createCloudflareApiService } from '../src/services/cloudflareApiService.ts';
import type { D1Param } from '../src/services/cloudflareApiService.ts';

interface DenoConfig {
    version: string;
}

/**
 * Read version from deno.json
 */
async function readVersion(): Promise<string> {
    try {
        const content = await Deno.readTextFile('deno.json');
        const config: DenoConfig = JSON.parse(content);
        return config.version;
    } catch (error) {
        console.error('Error reading version from deno.json:', error);
        Deno.exit(1);
    }
}

/**
 * Read D1 database ID from wrangler.toml
 */
async function readD1DatabaseId(): Promise<string | null> {
    try {
        const content = await Deno.readTextFile('wrangler.toml');

        // Simple TOML parsing for d1_databases section
        const dbIdMatch = content.match(/database_id\s*=\s*"([^"]+)"/);
        if (dbIdMatch) {
            return dbIdMatch[1];
        }

        return null;
    } catch (error) {
        console.error('Error reading wrangler.toml:', error);
        return null;
    }
}

/**
 * Get the next build number from D1
 */
async function getNextBuildNumber(accountId: string, databaseId: string, apiToken: string, version: string): Promise<number> {
    const cfApi = createCloudflareApiService({ apiToken });

    try {
        // Get current build number
        const result = await cfApi.queryD1<{ last_build_number: number }>(
            accountId,
            databaseId,
            'SELECT last_build_number FROM deployment_counter WHERE version = ?',
            [version],
        );

        const currentBuildNumber = result.result?.[0]?.last_build_number || 0;
        const nextBuildNumber = currentBuildNumber + 1;

        // Update counter
        await cfApi.queryD1(
            accountId,
            databaseId,
            `INSERT INTO deployment_counter (version, last_build_number, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(version) DO UPDATE SET
                last_build_number = ?,
                updated_at = datetime('now')`,
            [version, nextBuildNumber, nextBuildNumber] as D1Param[],
        );

        return nextBuildNumber;
    } catch (error) {
        console.error('Error getting build number from D1:', error);
        console.warn('Falling back to build number 1');
        return 1;
    }
}

/**
 * Main function
 */
async function main() {
    console.log('Generating deployment version...');

    // Get environment variables
    const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
    const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN');
    let databaseId = Deno.env.get('D1_DATABASE_ID') || undefined;

    // Read version from deno.json
    const version = await readVersion();
    console.log(`Current version: ${version}`);

    // If D1 credentials are available, get build number from database
    let buildNumber = 1;

    if (!databaseId) {
        const dbId = await readD1DatabaseId();
        databaseId = dbId || undefined;
    }

    if (accountId && apiToken && databaseId) {
        console.log('Querying D1 for build number...');
        buildNumber = await getNextBuildNumber(accountId, databaseId, apiToken, version);
    } else {
        console.warn('D1 credentials not available, using build number 1');
        console.warn('Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and D1_DATABASE_ID to enable build tracking');
    }

    // Generate full version
    const fullVersion = formatFullVersion(version, buildNumber);

    console.log(`Build number: ${buildNumber}`);
    console.log(`Full version: ${fullVersion}`);

    // Output for GitHub Actions
    const githubOutput = Deno.env.get('GITHUB_OUTPUT');
    if (githubOutput) {
        const outputContent = [
            `version=${version}`,
            `build_number=${buildNumber}`,
            `full_version=${fullVersion}`,
        ].join('\n');

        await Deno.writeTextFile(githubOutput, outputContent + '\n', { append: true });
        console.log('Version info written to GITHUB_OUTPUT');
    }

    // Output as JSON for other consumers
    const versionInfo = {
        version,
        buildNumber,
        fullVersion,
    };

    console.log('\nVersion info JSON:');
    console.log(JSON.stringify(versionInfo, null, 2));

    // Write to file for CI/CD
    await Deno.writeTextFile('.deployment-version.json', JSON.stringify(versionInfo, null, 2));
    console.log('\nVersion info written to .deployment-version.json');
}

// Run main function
if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        console.error('Fatal error:', error);
        Deno.exit(1);
    }
}
