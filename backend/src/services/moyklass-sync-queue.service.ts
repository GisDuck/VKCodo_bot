import { BookingStatus, PaymentMethod, PaymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { errorMessage, withExternalApiRetry } from "../lib/external-retry.js";
import { prisma } from "../lib/prisma.js";
import { MoyKlassService } from "./moyklass.service.js";

type SyncSource = "online_paid" | "pay_on_site";
type StepName = "create_child_user" | "create_join" | "create_lesson_record" | "create_payment";
type DbClient = PrismaClient | Prisma.TransactionClient;

const STEPS: StepName[] = ["create_child_user", "create_join", "create_lesson_record", "create_payment"];
const RETRY_DELAY_MS = 5 * 60_000;
const LOCK_TIMEOUT_MS = 15 * 60_000;

export class MoyKlassSyncQueueService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly moyKlass = new MoyKlassService()
  ) {}

  async enqueueOrder(orderId: string, source: SyncSource, db: DbClient = this.db) {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { booking: true } } }
    });

    for (const item of order.items) {
      const job = await db.moyKlassSyncJob.upsert({
        where: { bookingId: item.bookingId },
        update: {
          orderId: order.id,
          source,
          status: "pending",
          lastError: null,
          nextRunAt: null,
          lockedAt: null,
          lockedBy: null,
          completedAt: null
        },
        create: {
          orderId: order.id,
          bookingId: item.bookingId,
          source
        }
      });

      for (const step of STEPS) {
        const shouldSkipPayment = source === "pay_on_site" && step === "create_payment";
        const savedStep = await db.moyKlassSyncStep.findUnique({
          where: { jobId_step: { jobId: job.id, step } }
        });

        if (!savedStep) {
          await db.moyKlassSyncStep.create({
            data: {
              jobId: job.id,
              step,
              status: shouldSkipPayment ? "not_required" : "pending"
            }
          });
          continue;
        }

        if (savedStep.status === "done") continue;

        const nextStatus =
          shouldSkipPayment ? "not_required" : step === "create_payment" && savedStep.status === "not_required" ? "pending" : savedStep.status;

        await db.moyKlassSyncStep.update({
          where: { id: savedStep.id },
          data: {
            status: nextStatus,
            lastError: null
          }
        });
      }
    }
  }

  async processOrder(orderId: string) {
    const jobs = await this.db.moyKlassSyncJob.findMany({
      where: { orderId, status: { not: "done" } },
      orderBy: { createdAt: "asc" }
    });

    for (const job of jobs) {
      if (await this.claimJob(job.id)) await this.processJob(job.id);
    }
  }

  async processPending(limit = 20) {
    const jobs = await this.db.moyKlassSyncJob.findMany({
      where: {
        OR: [
          {
            status: { in: ["pending", "failed"] },
            OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
          },
          {
            status: "processing",
            lockedAt: { lt: new Date(Date.now() - LOCK_TIMEOUT_MS) }
          }
        ]
      },
      orderBy: { createdAt: "asc" },
      take: limit
    });

    let processed = 0;
    for (const job of jobs) {
      if (await this.claimJob(job.id)) {
        await this.processJob(job.id);
        processed += 1;
      }
    }

    return processed;
  }

  private async claimJob(jobId: string): Promise<boolean> {
    const result = await this.db.moyKlassSyncJob.updateMany({
      where: {
        id: jobId,
        OR: [
          {
            status: { in: ["pending", "failed"] },
            OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
          },
          {
            status: "processing",
            lockedAt: { lt: new Date(Date.now() - LOCK_TIMEOUT_MS) }
          }
        ]
      },
      data: {
        status: "processing",
        lastError: null,
        nextRunAt: null,
        lockedAt: new Date(),
        lockedBy: env.WORKER_ID
      }
    });

    return result.count === 1;
  }

  private async processJob(jobId: string) {
    try {
      for (const step of STEPS) {
        const savedStep = await this.db.moyKlassSyncStep.findUniqueOrThrow({
          where: { jobId_step: { jobId, step } }
        });
        if (savedStep.status === "done" || savedStep.status === "not_required") continue;

        await this.db.moyKlassSyncStep.update({
          where: { id: savedStep.id },
          data: { status: "processing", lastError: null }
        });

        try {
          const externalId = await withExternalApiRetry(() => this.executeStep(jobId, step), {
            attempts: 3,
            onRetry: async () => {
              await this.db.moyKlassSyncStep.update({
                where: { id: savedStep.id },
                data: { attempts: { increment: 1 } }
              });
            }
          });

          await this.db.moyKlassSyncStep.update({
            where: { id: savedStep.id },
            data: {
              status: "done",
              attempts: { increment: 1 },
              externalId,
              lastError: null,
              completedAt: new Date()
            }
          });
        } catch (error) {
          const message = errorMessage(error);
          await this.db.moyKlassSyncStep.update({
            where: { id: savedStep.id },
            data: {
              status: "failed",
              attempts: { increment: 1 },
              lastError: message
            }
          });
          await this.db.moyKlassSyncJob.update({
            where: { id: jobId },
            data: {
              status: "failed",
              lastError: message,
              nextRunAt: new Date(Date.now() + RETRY_DELAY_MS),
              lockedAt: null,
              lockedBy: null
            }
          });
          return;
        }
      }

      const job = await this.db.moyKlassSyncJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { booking: true }
      });
      await this.db.trialBooking.update({
        where: { id: job.bookingId },
        data: {
          status: job.source === "online_paid" ? BookingStatus.booked : BookingStatus.pay_on_site
        }
      });
      await this.db.moyKlassSyncJob.update({
        where: { id: jobId },
        data: {
          status: "done",
          lastError: null,
          nextRunAt: null,
          lockedAt: null,
          lockedBy: null,
          completedAt: new Date()
        }
      });
    } catch (error) {
      await this.db.moyKlassSyncJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          lastError: errorMessage(error),
          nextRunAt: new Date(Date.now() + RETRY_DELAY_MS),
          lockedAt: null,
          lockedBy: null
        }
      });
    }
  }

  private async executeStep(jobId: string, step: StepName): Promise<number | null> {
    const job = await this.db.moyKlassSyncJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        order: {
          include: {
            parent: true,
            payment: true
          }
        },
        booking: {
          include: {
            child: true,
            branch: true,
            orderItem: true
          }
        }
      }
    });
    const booking = job.booking;
    const child = booking.child;

    if (step === "create_child_user") {
      if (child.moyklassUserId) return child.moyklassUserId;
      const createdUser = await this.moyKlass.createUser({
        childName: child.name,
        childAge: child.age,
        phone: job.order.parent.phone ?? "",
        parentName: job.order.parent.name,
        filialId: booking.branch.moyklassId
      });
      await this.db.child.update({
        where: { id: child.id },
        data: { moyklassUserId: createdUser.id }
      });
      return createdUser.id;
    }

    const userId = child.moyklassUserId;
    if (!userId) throw new Error("MoyKlass user id is required before sync step");

    if (step === "create_join") {
      if (booking.moyklassJoinId) return booking.moyklassJoinId;
      if (!booking.moyklassClassId) throw new Error("MoyKlass class id is missing");
      const join = await this.moyKlass.createJoin({
        userId,
        classId: booking.moyklassClassId,
        priceRubles: (booking.orderItem?.amountKopecks ?? booking.priceKopecks) / 100
      });
      await this.db.trialBooking.update({
        where: { id: booking.id },
        data: { moyklassJoinId: join.id, status: BookingStatus.awaiting_payment }
      });
      return join.id;
    }

    if (step === "create_lesson_record") {
      if (booking.moyklassLessonRecordId) return booking.moyklassLessonRecordId;
      if (!booking.moyklassLessonId) throw new Error("MoyKlass lesson id is missing");
      const record = await this.moyKlass.createLessonRecord({
        userId,
        lessonId: booking.moyklassLessonId
      });
      await this.db.trialBooking.update({
        where: { id: booking.id },
        data: { moyklassLessonRecordId: record.id }
      });
      return record.id;
    }

    if (step === "create_payment") {
      if (job.source === "pay_on_site") return null;
      if (job.order.payment?.method !== PaymentMethod.online || job.order.payment.status !== PaymentStatus.paid) {
        throw new Error("Online payment must be paid before MoyKlass payment sync");
      }
      const payment = await this.moyKlass.createPayment({
        userId,
        filialId: booking.branch.moyklassId,
        summaRubles: (booking.orderItem?.amountKopecks ?? booking.priceKopecks) / 100
      });
      return payment.id;
    }

    throw new Error(`Unknown MoyKlass sync step: ${step}`);
  }
}
