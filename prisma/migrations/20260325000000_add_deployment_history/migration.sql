-- AddBanFieldsToUsers
ALTER TABLE "users"
    ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ban_reason" TEXT,
    ADD COLUMN "ban_expires" TIMESTAMPTZ;

-- AddDeploymentHistory
CREATE TABLE "deployment_history" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "build_number" INTEGER NOT NULL,
    "full_version" TEXT NOT NULL,
    "git_commit" TEXT NOT NULL,
    "git_branch" TEXT NOT NULL,
    "deployed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deployed_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "deployment_duration" INTEGER,
    "workflow_run_id" TEXT,
    "workflow_run_url" TEXT,
    "metadata" JSONB,
    CONSTRAINT "deployment_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deployment_history_full_version_key" ON "deployment_history"("full_version");
CREATE UNIQUE INDEX "deployment_history_unique_deployment" ON "deployment_history"("version", "build_number");
CREATE INDEX "deployment_history_version_idx" ON "deployment_history"("version");
CREATE INDEX "deployment_history_build_number_idx" ON "deployment_history"("build_number");
CREATE INDEX "deployment_history_deployed_at_idx" ON "deployment_history"("deployed_at" DESC);
CREATE INDEX "deployment_history_status_idx" ON "deployment_history"("status");
CREATE INDEX "deployment_history_git_commit_idx" ON "deployment_history"("git_commit");

-- AddDeploymentCounter
CREATE TABLE "deployment_counter" (
    "version" TEXT NOT NULL,
    "last_build_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "deployment_counter_pkey" PRIMARY KEY ("version")
);
