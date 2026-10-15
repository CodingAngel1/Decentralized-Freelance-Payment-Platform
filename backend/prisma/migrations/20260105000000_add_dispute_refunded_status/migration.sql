-- AlterEnum
-- A dispute whose escrow was refunded (expiry or dispute timelock) is terminal,
-- so it needs a value distinct from RESOLVED (a panel ruling).
ALTER TYPE "DisputeStatus" ADD VALUE 'REFUNDED';
