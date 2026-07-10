-- Durable VK callback inbox.
CREATE TABLE "VkInboundEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "vkEventId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VkInboundEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VkInboundEvent_eventKey_key" ON "VkInboundEvent"("eventKey");
CREATE INDEX "VkInboundEvent_status_nextRunAt_idx" ON "VkInboundEvent"("status", "nextRunAt");
CREATE INDEX "VkInboundEvent_receivedAt_idx" ON "VkInboundEvent"("receivedAt");

-- Queue locking and paid notification idempotency.
ALTER TABLE "MoyKlassSyncJob" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "MoyKlassSyncJob" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "Payment" ADD COLUMN "paidNotificationSentAt" TIMESTAMP(3);

CREATE INDEX "MoyKlassSyncJob_status_lockedAt_idx" ON "MoyKlassSyncJob"("status", "lockedAt");
