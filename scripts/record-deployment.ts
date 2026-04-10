#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env

/**
 * Record deployment information after successful worker deployment
 *
 * This script:
 * 1. Reads deployment version info
 * 2. Collects git metadata
 * 3. Collects CI/CD metadata
 * 4. Records the deployment in Neon PostgreSQL via @neondatabase/serverless
 *
 * Usage:
 *   deno run --allow-read --allow-net --allow-env scripts/record-deployment.ts [--status=success|failed]
 *
 * Environment variables:
 *   DIRECT_DATABASE_URL - Neon PostgreSQL direct connection string (bypasses pooling)
 *   GITHUB_SHA - Git commit SHA (from GitHub Actions)
 *   GITHUB_REF - Git ref (from GitHub Actions)
 *   GITHUB_ACTOR - GitHub actor (from GitHub Actions)
 *   GITHUB_RUN_ID - GitHub workflow run ID (from GitHub Actions)
 *   GITHUB_SERVER_URL - GitHub server URL (from GitHub Actions)
 *   GITHUB_REPOSITORY - GitHub repository (from GitHub Actions)
 */

import { parseArgs } from '@std/cli/parse-args';
import { generateDeploymentId } from '../src/deployment/version.ts';
import { neon } from '@neondatabase/serverless';

/**
 * Extract a human-readable error message from any thrown value.
 */
function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface VersionInfo {
    version: string;
    buildNumber: number;
    fullVersion: string;
}

interface DeploymentMetadata {
    ci_platform?: string;
    workflow_name?: string;
    workflow_run_id?: string;
    workflow_run_url?: string;
    actor?: string;
    repository?: string;
    [key: string]: unknown;
}

/**
 * Read version info from file
 */
async function readVersionInfo(): Promise<VersionInfo | null> {
    try {
        const content = await Deno.readTextFile('.deployment-version.json');
        return JSON.parse(content);
    } catch (error) {
        console.error('Error reading .deployment-version.json:', error);
        return null;
    }
}

/**
 * Get git commit SHA
 */
function getGitCommit(): string {
    return Deno.env.get('GITHUB_SHA') || 'unknown';
}

/**
 * Get git branch
 */
function getGitBranch(): string {
    const ref = Deno.env.get('GITHUB_REF') || '';
    // Extract branch name from refs/heads/branch-name
    const match = ref.match(/refs\/heads\/(.+)/);
    return match ? match[1] : 'unknown';
}

/**
 * Get deployment actor (who deployed)
 */
function getDeployedBy(): string {
    const actor = Deno.env.get('GITHUB_ACTOR');
    if (actor) {
        return `github-actions[${actor}]`;
    }
    return 'github-actions';
}

/**
 * Get deployment metadata
 */
function getDeploymentMetadata(): DeploymentMetadata {
    const metadata: DeploymentMetadata = {
        ci_platform: 'github-actions',
    };

    const workflowRunId = Deno.env.get('GITHUB_RUN_ID');
    if (workflowRunId) {
        metadata.workflow_run_id = workflowRunId;
    }

    const serverUrl = Deno.env.get('GITHUB_SERVER_URL');
    const repository = Deno.env.get('GITHUB_REPOSITORY');
    if (serverUrl && repository && workflowRunId) {
        metadata.workflow_run_url = `${serverUrl}/${repository}/actions/runs/${workflowRunId}`;
    }

    const actor = Deno.env.get('GITHUB_ACTOR');
    if (actor) {
        metadata.actor = actor;
    }

    if (repository) {
        metadata.repository = repository;
    }

    const workflowName = Deno.env.get('GITHUB_WORKFLOW');
    if (workflowName) {
        metadata.workflow_name = workflowName;
    }

    return metadata;
}

/**
 * Record deployment in Neon PostgreSQL via @neondatabase/serverless.
 * Uses DIRECT_DATABASE_URL (bypasses connection pooling for direct writes).
 */
async function recordDeployment(
    directDatabaseUrl: string,
    versionInfo: VersionInfo,
    status: 'success' | 'failed',
): Promise<void> {
    const id = generateDeploymentId();
    const gitCommit = getGitCommit();
    const gitBranch = getGitBranch();
    const deployedBy = getDeployedBy();
    const metadata = getDeploymentMetadata();

    console.log(`Recording deployment: ${versionInfo.fullVersion}`);
    console.log(`  ID: ${id}`);
    console.log(`  Git commit: ${gitCommit}`);
    console.log(`  Git branch: ${gitBranch}`);
    console.log(`  Deployed by: ${deployedBy}`);
    console.log(`  Status: ${status}`);

    const sql = neon(directDatabaseUrl);

    // Upsert the deployment counter to get/increment the build number
    await sql(
        `INSERT INTO deployment_counter (version, last_build_number, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (version) DO UPDATE SET last_build_number = EXCLUDED.last_build_number, updated_at = NOW()`,
        [versionInfo.version, versionInfo.buildNumber],
    );

    // Upsert the deployment history record
    await sql(
        `INSERT INTO deployment_history
             (id, version, build_number, full_version, git_commit, git_branch, deployed_by, status, workflow_run_id, workflow_run_url, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (full_version) DO UPDATE SET
             status = EXCLUDED.status,
             git_commit = EXCLUDED.git_commit,
             git_branch = EXCLUDED.git_branch,
             deployed_by = EXCLUDED.deployed_by,
             workflow_run_id = EXCLUDED.workflow_run_id,
             workflow_run_url = EXCLUDED.workflow_run_url,
             metadata = EXCLUDED.metadata`,
        [
            id,
            versionInfo.version,
            versionInfo.buildNumber,
            versionInfo.fullVersion,
            gitCommit,
            gitBranch,
            deployedBy,
            status,
            metadata.workflow_run_id ?? null,
            metadata.workflow_run_url ?? null,
            JSON.stringify(metadata),
        ],
    );

    console.log('✓ Deployment recorded successfully');
}

/**
 * Main function
 */
async function main() {
    console.log('Recording deployment...');

    // Parse command line arguments
    const args = parseArgs(Deno.args, {
        string: ['status'],
        default: {
            status: 'success',
        },
    });

    const status = args.status as 'success' | 'failed';
    if (status !== 'success' && status !== 'failed') {
        console.error('Invalid status. Must be "success" or "failed"');
        Deno.exit(1);
    }

    // Get the direct database URL (bypasses Hyperdrive connection pooling)
    const directDatabaseUrl = Deno.env.get('DIRECT_DATABASE_URL');

    if (!directDatabaseUrl) {
        console.error('Missing required environment variable: DIRECT_DATABASE_URL');
        console.error('\nDeployment will not be recorded in database.');
        Deno.exit(0); // Don't fail the deployment
    }

    // Read version info
    const versionInfo = await readVersionInfo();
    if (!versionInfo) {
        console.error('Could not read version info from .deployment-version.json');
        console.error('Deployment will not be recorded.');
        Deno.exit(0); // Don't fail the deployment
    }

    // Record deployment
    try {
        await recordDeployment(directDatabaseUrl, versionInfo, status);
    } catch (error) {
        const msg = getErrorMessage(error);
        console.warn(`⚠️  Could not record deployment to Neon: ${msg}`);
        console.warn('   This is non-blocking — it does not affect the deployment result.');
        Deno.exit(0); // Don't fail the deployment
    }

    console.log('\nDeployment information:');
    console.log(`  Version: ${versionInfo.fullVersion}`);
    console.log(`  Git commit: ${getGitCommit()}`);
    console.log(`  Git branch: ${getGitBranch()}`);
    console.log(`  Deployed by: ${getDeployedBy()}`);
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
