-- Phase D-tick — ImportJob lease columns for chunked Customer 360 commit.
--
-- Concurrent-tick guard: when a tick claims a job it sets leaseTickId +
-- leaseAt + heartbeatAt; release/stale-TTL clears them. Only the
-- customer360 commit path writes; Phase 1 imports never touch these.
--
-- Additive + nullable: existing ImportJob rows continue to work with
-- leaseTickId/leaseAt/heartbeatAt = NULL. No backfill needed.

ALTER TABLE "ImportJob" ADD COLUMN "leaseTickId" TEXT;
ALTER TABLE "ImportJob" ADD COLUMN "leaseAt" TIMESTAMP(3);
ALTER TABLE "ImportJob" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
