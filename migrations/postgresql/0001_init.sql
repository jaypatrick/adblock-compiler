-- PostgreSQL Schema for AdBlock Compiler
-- Generated from Prisma schema for PostgreSQL

-- Enable UUID extension for better ID generation (optional, uses cuid by default)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Storage Entry - Generic key-value storage with metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS storage_entries (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    tags TEXT
);

CREATE INDEX IF NOT EXISTS idx_storage_entries_key ON storage_entries(key);
CREATE INDEX IF NOT EXISTS idx_storage_entries_expires_at ON storage_entries("expiresAt");

-- ============================================================================
-- Filter Cache - Cached filter list downloads
-- ============================================================================

CREATE TABLE IF NOT EXISTS filter_cache (
    id TEXT PRIMARY KEY,
    source TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    hash TEXT NOT NULL,
    etag TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_filter_cache_source ON filter_cache(source);
CREATE INDEX IF NOT EXISTS idx_filter_cache_expires_at ON filter_cache("expiresAt");

-- ============================================================================
-- Compilation Metadata - Build history tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS compilation_metadata (
    id TEXT PRIMARY KEY,
    "configName" TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceCount" INTEGER NOT NULL,
    "ruleCount" INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    "outputPath" TEXT
);

CREATE INDEX IF NOT EXISTS idx_compilation_metadata_config_name ON compilation_metadata("configName");
CREATE INDEX IF NOT EXISTS idx_compilation_metadata_timestamp ON compilation_metadata(timestamp);

-- ============================================================================
-- Source Snapshot - Point-in-time source state for change detection
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_snapshots (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "ruleCount" INTEGER NOT NULL,
    "ruleSample" TEXT,
    etag TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_snapshots_source_is_current ON source_snapshots(source, "isCurrent");
CREATE INDEX IF NOT EXISTS idx_source_snapshots_source ON source_snapshots(source);
CREATE INDEX IF NOT EXISTS idx_source_snapshots_timestamp ON source_snapshots(timestamp);

-- ============================================================================
-- Source Health - Reliability metrics for filter sources
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_health (
    id TEXT PRIMARY KEY,
    source TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    "totalAttempts" INTEGER NOT NULL DEFAULT 0,
    "successfulAttempts" INTEGER NOT NULL DEFAULT 0,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "averageDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageRuleCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP WITH TIME ZONE,
    "lastSuccessAt" TIMESTAMP WITH TIME ZONE,
    "lastFailureAt" TIMESTAMP WITH TIME ZONE,
    "recentAttempts" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_health_source ON source_health(source);
CREATE INDEX IF NOT EXISTS idx_source_health_status ON source_health(status);

-- ============================================================================
-- Source Attempt - Individual fetch attempt record
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_attempts (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    duration INTEGER NOT NULL,
    error TEXT,
    "ruleCount" INTEGER,
    etag TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_attempts_source ON source_attempts(source);
CREATE INDEX IF NOT EXISTS idx_source_attempts_timestamp ON source_attempts(timestamp);
