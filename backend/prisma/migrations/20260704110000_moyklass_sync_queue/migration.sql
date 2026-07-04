-- CreateTable
CREATE TABLE "MoyKlassSyncJob" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL,
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoyKlassSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoyKlassSyncStep" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalId" INTEGER,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoyKlassSyncStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoyKlassSyncJob_bookingId_key" ON "MoyKlassSyncJob"("bookingId");

-- CreateIndex
CREATE INDEX "MoyKlassSyncJob_status_nextRunAt_idx" ON "MoyKlassSyncJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "MoyKlassSyncJob_orderId_idx" ON "MoyKlassSyncJob"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MoyKlassSyncStep_jobId_step_key" ON "MoyKlassSyncStep"("jobId", "step");

-- CreateIndex
CREATE INDEX "MoyKlassSyncStep_status_idx" ON "MoyKlassSyncStep"("status");

-- AddForeignKey
ALTER TABLE "MoyKlassSyncJob" ADD CONSTRAINT "MoyKlassSyncJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoyKlassSyncJob" ADD CONSTRAINT "MoyKlassSyncJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TrialBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoyKlassSyncStep" ADD CONSTRAINT "MoyKlassSyncStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MoyKlassSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
