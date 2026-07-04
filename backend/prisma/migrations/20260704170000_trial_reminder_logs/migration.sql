CREATE TABLE "TrialReminderLog" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialReminderLog_bookingId_type_targetDate_key" ON "TrialReminderLog"("bookingId", "type", "targetDate");
CREATE INDEX "TrialReminderLog_sentAt_idx" ON "TrialReminderLog"("sentAt");

ALTER TABLE "TrialReminderLog"
ADD CONSTRAINT "TrialReminderLog_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "TrialBooking"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
