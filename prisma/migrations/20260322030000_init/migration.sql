-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "clerk_user_id" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "first_name" TEXT,
    "last_name" TEXT,
    "image_url" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_sign_in_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['compile']::TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "last_used_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "token_hash" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ,
    "refresh_token_expires_at" TIMESTAMPTZ,
    "scope" TEXT,
    "id_token" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_sources" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "homepage" TEXT,
    "license" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "owner_user_id" UUID,
    "refresh_interval_seconds" INTEGER NOT NULL DEFAULT 3600,
    "last_checked_at" TIMESTAMPTZ,
    "last_success_at" TIMESTAMPTZ,
    "last_failure_at" TIMESTAMPTZ,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "filter_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_list_versions" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "rule_count" INTEGER NOT NULL,
    "etag" TEXT,
    "r2_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "filter_list_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compiled_outputs" (
    "id" UUID NOT NULL,
    "config_hash" TEXT NOT NULL,
    "config_name" TEXT NOT NULL,
    "config_snapshot" JSONB NOT NULL,
    "rule_count" INTEGER NOT NULL,
    "source_count" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "r2_key" TEXT NOT NULL,
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "compiled_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compilation_events" (
    "id" UUID NOT NULL,
    "compiled_output_id" UUID,
    "user_id" UUID,
    "api_key_id" UUID,
    "request_source" TEXT NOT NULL,
    "worker_region" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compilation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_health_snapshots" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "total_attempts" INTEGER NOT NULL DEFAULT 0,
    "successful_attempts" INTEGER NOT NULL DEFAULT 0,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "avg_duration_ms" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_rule_count" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_change_events" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "previous_version_id" UUID,
    "new_version_id" UUID NOT NULL,
    "rule_count_delta" INTEGER NOT NULL DEFAULT 0,
    "content_hash_changed" BOOLEAN NOT NULL DEFAULT true,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_entries" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "tags" TEXT,

    CONSTRAINT "storage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_cache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "etag" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "filter_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compilation_metadata" (
    "id" TEXT NOT NULL,
    "configName" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceCount" INTEGER NOT NULL,
    "ruleCount" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "outputPath" TEXT,

    CONSTRAINT "compilation_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_user_provider_unique" ON "account"("user_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "filter_sources_url_key" ON "filter_sources"("url");

-- CreateIndex
CREATE INDEX "filter_sources_status_idx" ON "filter_sources"("status");

-- CreateIndex
CREATE INDEX "idx_filter_list_versions_source_current" ON "filter_list_versions"("source_id", "is_current");

-- CreateIndex
CREATE INDEX "filter_list_versions_content_hash_idx" ON "filter_list_versions"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "compiled_outputs_config_hash_key" ON "compiled_outputs"("config_hash");

-- CreateIndex
CREATE INDEX "compiled_outputs_config_name_idx" ON "compiled_outputs"("config_name");

-- CreateIndex
CREATE INDEX "compiled_outputs_created_at_idx" ON "compiled_outputs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "compiled_outputs_owner_user_id_idx" ON "compiled_outputs"("owner_user_id");

-- CreateIndex
CREATE INDEX "compilation_events_created_at_idx" ON "compilation_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "compilation_events_user_id_idx" ON "compilation_events"("user_id");

-- CreateIndex
CREATE INDEX "source_health_snapshots_source_id_idx" ON "source_health_snapshots"("source_id");

-- CreateIndex
CREATE INDEX "source_health_snapshots_recorded_at_idx" ON "source_health_snapshots"("recorded_at" DESC);

-- CreateIndex
CREATE INDEX "source_change_events_source_id_idx" ON "source_change_events"("source_id");

-- CreateIndex
CREATE INDEX "source_change_events_detected_at_idx" ON "source_change_events"("detected_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "storage_entries_key_key" ON "storage_entries"("key");

-- CreateIndex
CREATE INDEX "storage_entries_key_idx" ON "storage_entries"("key");

-- CreateIndex
CREATE INDEX "storage_entries_expires_at_idx" ON "storage_entries"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "filter_cache_source_key" ON "filter_cache"("source");

-- CreateIndex
CREATE INDEX "filter_cache_source_idx" ON "filter_cache"("source");

-- CreateIndex
CREATE INDEX "filter_cache_expires_at_idx" ON "filter_cache"("expires_at");

-- CreateIndex
CREATE INDEX "compilation_metadata_configName_idx" ON "compilation_metadata"("configName");

-- CreateIndex
CREATE INDEX "compilation_metadata_timestamp_idx" ON "compilation_metadata"("timestamp");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_list_versions" ADD CONSTRAINT "filter_list_versions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "filter_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compilation_events" ADD CONSTRAINT "compilation_events_compiled_output_id_fkey" FOREIGN KEY ("compiled_output_id") REFERENCES "compiled_outputs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_health_snapshots" ADD CONSTRAINT "source_health_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "filter_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_change_events" ADD CONSTRAINT "source_change_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "filter_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

