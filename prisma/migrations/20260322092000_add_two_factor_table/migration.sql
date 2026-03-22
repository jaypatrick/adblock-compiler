-- Add two_factor_enabled column to users table
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: two_factor (Better Auth TOTP plugin — 1:1 with users)
CREATE TABLE "two_factor" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint enforces 1:1 User↔TwoFactor relationship
CREATE UNIQUE INDEX "two_factor_user_id_key" ON "two_factor"("user_id");

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
