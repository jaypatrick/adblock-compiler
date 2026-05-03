-- AddIndex: verification.identifier
-- Recommended by Better Auth performance guide for faster token/code lookups
-- See: https://better-auth.com/docs/guides/optimizing-for-performance#database-optimizations
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");
