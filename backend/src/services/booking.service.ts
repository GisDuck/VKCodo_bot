import {
  BookingStatus,
  BotCourseCode,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient
} from "@prisma/client";
import { env } from "../config/env.js";
import { TRIAL_LOOKUP_DAYS } from "../domain/catalog.js";
import { addDays } from "../lib/dates.js";
import { resolveTodayForDeveloperMode } from "../lib/developer-date.js";
import { assertPersonName } from "../lib/person-name.js";
import { prisma } from "../lib/prisma.js";
import { LessonFormatService, type LessonListResult } from "./lesson-format.service.js";
import { MoyKlassService } from "./moyklass.service.js";
import { MoyKlassSyncQueueService } from "./moyklass-sync-queue.service.js";
import { PricingService } from "./pricing.service.js";
import { TBankService } from "./tbank.service.js";

export type SelectedLesson = {
  lessonId: number;
  classId: number;
  date: string;
  beginTime: string;
};

export type BookingDraftInput = {
  parentId: string;
  childName: string;
  childAge: number;
  branchId: string;
  botCourseCode: BotCourseCode;
  lesson: SelectedLesson;
};

export type AvailableLessonsResult = LessonListResult & {
  hasCourseInBranch: boolean;
};

export class BookingService {
  private readonly lessonFormatter = new LessonFormatService();
  private readonly pricing = new PricingService();
  private readonly moyKlassQueue: MoyKlassSyncQueueService;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly moyKlass = new MoyKlassService(),
    private readonly tbank = new TBankService()
  ) {
    this.moyKlassQueue = new MoyKlassSyncQueueService(this.db, this.moyKlass);
  }

  async upsertParent(input: {
    vkUserId: number;
    name?: string | null;
    phone?: string | null;
    referralPayload?: string | null;
  }) {
    const parentName = input.name ? assertPersonName(input.name, "Имя родителя") : input.name;
    return this.db.parent.upsert({
      where: { vkUserId: BigInt(input.vkUserId) },
      update: {
        name: parentName ?? undefined,
        phone: input.phone ?? undefined,
        referralPayload: input.referralPayload ?? undefined,
        referralApplied: input.referralPayload ? true : undefined
      },
      create: {
        vkUserId: BigInt(input.vkUserId),
        name: parentName,
        phone: input.phone,
        referralPayload: input.referralPayload,
        referralApplied: Boolean(input.referralPayload)
      }
    });
  }

  async getAvailableLessons(branchId: string, courseCode: BotCourseCode): Promise<AvailableLessonsResult> {
    const branch = await this.db.branch.findUniqueOrThrow({ where: { id: branchId } });
    const course = await this.db.botCourse.findUniqueOrThrow({
      where: { code: courseCode },
      include: { mapping: true }
    });
    const courseId = course.mapping?.moyklassCourseId;
    if (!courseId) throw new Error(`Course mapping for ${courseCode} is not configured`);

    const classes = await this.moyKlass.getClasses(branch.moyklassId, courseId);
    if (classes.length === 0) {
      return {
        lessons: [],
        lessonsText: "",
        maxLessonNumber: null,
        hasCourseInBranch: false
      };
    }

    const lookupSettings = await this.getLessonLookupSettings();
    const lessons = await this.moyKlass.getLessons({
      dateFrom: lookupSettings.startDate,
      dateTo: addDays(lookupSettings.startDate, TRIAL_LOOKUP_DAYS),
      classIds: classes.map((item) => item.id)
    });

    return {
      ...this.lessonFormatter.buildAvailableLessonList(lessons, {
        includeUnavailable: lookupSettings.developerMode
      }),
      hasCourseInBranch: true
    };
  }

  private async getLessonLookupSettings(): Promise<{ startDate: Date; developerMode: boolean }> {
    const [developerMode, developerTodayDate] = await Promise.all([
      this.db.appSetting.findUnique({ where: { key: "developerMode" } }),
      this.db.appSetting.findUnique({ where: { key: "developerTodayDate" } })
    ]);
    const enabled = developerMode?.value === true;

    return {
      startDate: resolveTodayForDeveloperMode(env.NODE_ENV === "production" ? false : enabled, developerTodayDate?.value),
      developerMode: env.NODE_ENV === "production" ? false : enabled
    };
  }

  private async getPaymentTestMode(): Promise<boolean> {
    const setting = await this.db.appSetting.findUnique({ where: { key: "paymentTestMode" } });
    return typeof setting?.value === "boolean" ? setting.value : env.PAYMENT_TEST_MODE;
  }

  async createDraftBooking(input: BookingDraftInput) {
    const childName = assertPersonName(input.childName, "Имя ребенка");
    const parent = await this.db.parent.findUniqueOrThrow({ where: { id: input.parentId } });
    const child = await this.db.child.create({
      data: {
        parentId: parent.id,
        name: childName,
        age: input.childAge,
        status: "trial"
      }
    });
    const course = await this.db.botCourse.findUniqueOrThrow({ where: { code: input.botCourseCode } });

    return this.db.trialBooking.create({
      data: {
        childId: child.id,
        branchId: input.branchId,
        botCourseId: course.id,
        moyklassClassId: input.lesson.classId,
        moyklassLessonId: input.lesson.lessonId,
        lessonDate: new Date(`${input.lesson.date}T00:00:00.000Z`),
        lessonBeginTime: input.lesson.beginTime,
        status: "draft",
        priceKopecks: this.pricing.getTrialPriceKopecks(parent.referralApplied)
      },
      include: { child: true, branch: true, botCourse: true }
    });
  }

  async createOrderFromBookings(parentId: string, bookingIds: string[]) {
    const parent = await this.db.parent.findUniqueOrThrow({ where: { id: parentId } });
    const bookings = await this.db.trialBooking.findMany({
      where: { id: { in: bookingIds } },
      include: { child: true, botCourse: true }
    });

    if (bookings.length !== bookingIds.length) {
      throw new Error("Some bookings were not found");
    }

    const itemPriceKopecks = this.pricing.getTrialPriceKopecks(parent.referralApplied);
    const expiresAt = new Date(Date.now() + env.PAYMENT_EXPIRES_MINUTES * 60_000);

    return this.db.order.create({
      data: {
        parentId,
        status: "draft",
        totalKopecks: itemPriceKopecks * bookings.length,
        expiresAt,
        items: {
          create: bookings.map((booking) => ({
            childId: booking.childId,
            bookingId: booking.id,
            botCourseId: booking.botCourseId,
            title: `${booking.child.name}: ${booking.botCourse.title}`,
            amountKopecks: itemPriceKopecks
          }))
        }
      },
      include: {
        parent: true,
        items: { include: { child: true, booking: { include: { branch: true, botCourse: true } } } },
        payment: true
      }
    });
  }

  async initOnlinePayment(orderId: string) {
    const order = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        parent: true,
        items: { include: { child: true, booking: { include: { branch: true } } } },
        payment: true
      }
    });

    if (order.status === OrderStatus.paid) return order.payment;
    if (order.payment?.status === PaymentStatus.pending && order.payment.paymentUrl) return order.payment;

    const paymentTestMode = await this.getPaymentTestMode();
    const chargedKopecks = paymentTestMode ? 100 : order.totalKopecks;
    const receiptItems = paymentTestMode
      ? [
          {
            Name: "тест",
            Price: chargedKopecks,
            Quantity: 1,
            Amount: chargedKopecks,
            Tax: "none" as const
          }
        ]
      : order.items.map((item) => ({
          Name: item.title,
          Price: item.amountKopecks,
          Quantity: 1,
          Amount: item.amountKopecks,
          Tax: "none" as const
        }));

    const payment = await this.tbank.initPayment({
      orderId: order.id,
      amountKopecks: chargedKopecks,
      description: paymentTestMode ? "тест" : "Оплата пробного занятия",
      customerPhone: order.parent.phone,
      receiptItems
    });

    return this.db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.awaiting_payment }
      });

      return tx.payment.upsert({
        where: { orderId: order.id },
        update: {
          method: PaymentMethod.online,
          status: PaymentStatus.pending,
          realAmountKopecks: order.totalKopecks,
          chargedKopecks,
          tbankPaymentId: payment.paymentId,
          tbankOrderId: payment.orderId,
          paymentUrl: payment.paymentUrl
        },
        create: {
          orderId: order.id,
          method: PaymentMethod.online,
          status: PaymentStatus.pending,
          realAmountKopecks: order.totalKopecks,
          chargedKopecks,
          tbankPaymentId: payment.paymentId,
          tbankOrderId: payment.orderId,
          paymentUrl: payment.paymentUrl
        }
      });
    });
  }

  async markPayOnSite(orderId: string) {
    const payment = await this.db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.pay_on_site } });
      await tx.trialBooking.updateMany({
        where: { orderItem: { orderId } },
        data: { status: BookingStatus.pay_on_site }
      });

      const savedPayment = await tx.payment.upsert({
        where: { orderId },
        update: {
          method: PaymentMethod.on_site,
          status: PaymentStatus.pending
        },
        create: {
          orderId,
          method: PaymentMethod.on_site,
          status: PaymentStatus.pending,
          realAmountKopecks: (
            await tx.order.findUniqueOrThrow({ where: { id: orderId } })
          ).totalKopecks,
          chargedKopecks: 0
        }
      });

      await this.moyKlassQueue.enqueueOrder(orderId, "pay_on_site", tx);
      return savedPayment;
    });

    void this.moyKlassQueue.processOrder(orderId).catch((error) => {
      console.error("Failed to process MoyKlass pay-on-site queue", error);
    });

    return payment;
  }

  async expirePendingOrders() {
    const orders = await this.db.order.findMany({
      where: {
        status: OrderStatus.awaiting_payment,
        expiresAt: { lt: new Date() },
        payment: { status: PaymentStatus.pending }
      },
      select: { id: true }
    });

    for (const order of orders) {
      await this.db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.expired_to_pay_on_site }
        });
        await tx.payment.updateMany({
          where: { orderId: order.id, status: PaymentStatus.pending },
          data: { status: PaymentStatus.expired }
        });
        await tx.trialBooking.updateMany({
          where: { orderItem: { orderId: order.id } },
          data: { status: BookingStatus.pay_on_site }
        });
      });
    }

    return orders.length;
  }

  async handlePaidOrder(orderId: string) {
    const result = await this.db.$transaction(async (tx) => {
      const currentPayment = await tx.payment.findUniqueOrThrow({ where: { orderId } });
      const shouldNotify = !currentPayment.paidNotificationSentAt;

      await tx.trialBooking.updateMany({
        where: { orderItem: { orderId } },
        data: { status: BookingStatus.booked }
      });

      await tx.payment.update({
        where: { orderId },
        data: { status: PaymentStatus.paid }
      });

      const order = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.paid },
        include: { parent: true }
      });

      await this.moyKlassQueue.enqueueOrder(orderId, "online_paid", tx);
      return { order, shouldNotify };
    });

    void this.moyKlassQueue.processOrder(orderId).catch((error) => {
      console.error("Failed to process MoyKlass paid queue", error);
    });

    return result;
  }

  async markPaidNotificationSent(orderId: string) {
    await this.db.payment.updateMany({
      where: { orderId, paidNotificationSentAt: null },
      data: { paidNotificationSentAt: new Date() }
    });
  }

  async cancelBooking(bookingId: string) {
    const booking = await this.db.trialBooking.findUniqueOrThrow({ where: { id: bookingId } });
    if (booking.moyklassLessonRecordId) {
      await this.moyKlass.cancelLessonRecord(booking.moyklassLessonRecordId).catch(() => undefined);
    }
    if (booking.moyklassJoinId) {
      await this.moyKlass.cancelJoin(booking.moyklassJoinId).catch(() => undefined);
    }

    return this.db.trialBooking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.cancelled }
    });
  }

  async releaseExternalRecords(bookingId: string) {
    const booking = await this.db.trialBooking.findUniqueOrThrow({ where: { id: bookingId } });
    if (booking.moyklassLessonRecordId) {
      await this.moyKlass.cancelLessonRecord(booking.moyklassLessonRecordId).catch(() => undefined);
    }
    if (booking.moyklassJoinId) {
      await this.moyKlass.cancelJoin(booking.moyklassJoinId).catch(() => undefined);
    }
    await this.db.trialBooking.update({
      where: { id: bookingId },
      data: {
        moyklassJoinId: null,
        moyklassLessonRecordId: null
      }
    });
  }

  async releaseLessonRecord(bookingId: string) {
    const booking = await this.db.trialBooking.findUniqueOrThrow({ where: { id: bookingId } });
    if (booking.moyklassLessonRecordId) {
      await this.moyKlass.cancelLessonRecord(booking.moyklassLessonRecordId).catch(() => undefined);
    }
    await this.db.trialBooking.update({
      where: { id: bookingId },
      data: { moyklassLessonRecordId: null }
    });
  }

  async syncLessonRecordForBooking(bookingId: string) {
    const booking = await this.db.trialBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { child: true }
    });
    if (!booking.child.moyklassUserId || !booking.moyklassLessonId) return;

    const record = await this.moyKlass.createLessonRecord({
      userId: booking.child.moyklassUserId,
      lessonId: booking.moyklassLessonId
    });

    await this.db.trialBooking.update({
      where: { id: bookingId },
      data: { moyklassLessonRecordId: record.id }
    });
  }

  async syncExternalRecordsForBooking(bookingId: string) {
    const item = await this.db.orderItem.findUnique({
      where: { bookingId },
      include: { order: { include: { payment: true } } }
    });
    if (item) {
      const source = item.order.payment?.method === PaymentMethod.online ? "online_paid" : "pay_on_site";
      await this.moyKlassQueue.enqueueOrder(item.orderId, source);
      await this.moyKlassQueue.processOrder(item.orderId);
    }
  }
}
