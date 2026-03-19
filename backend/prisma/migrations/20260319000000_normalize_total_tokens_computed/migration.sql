-- Migration: normalize_total_tokens_computed
--
-- Context: The dev database was provisioned before Prisma migrations were written,
-- so it has total_tokens as a COMPUTED PERSISTED column (the intended design).
-- The prod database was provisioned via Prisma migrate deploy, which created
-- total_tokens as a plain INT (Prisma DSL cannot express computed columns).
--
-- This migration aligns prod with dev and with the code's intent:
--   - total_tokens should always equal input_tokens + output_tokens
--   - The main persistence path (MessagePersistenceWorker) does not write total_tokens
--   - The type comment in message.types.ts explicitly states it is a computed column
--
-- Safety:
--   - The IF NOT EXISTS guard makes this a no-op on dev (already computed)
--   - On prod: drops the plain INT column and re-adds as computed PERSISTED
--   - Existing prod rows with correct input/output tokens will auto-recalculate
--   - Formula matches exactly what dev uses: isnull(input,0)+isnull(output,0)

IF NOT EXISTS (
  SELECT 1 FROM sys.computed_columns
  WHERE name = 'total_tokens'
    AND object_id = OBJECT_ID('[dbo].[messages]')
)
BEGIN
  ALTER TABLE [dbo].[messages] DROP COLUMN [total_tokens];
  ALTER TABLE [dbo].[messages] ADD [total_tokens] AS (ISNULL([input_tokens], (0)) + ISNULL([output_tokens], (0))) PERSISTED;
END
