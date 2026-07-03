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
import { prisma } from "../lib/prisma.js";
import { LessonFormatService } from "./lesson-format.service.js";
import { MoyKlassService } from "./moyklass.service.js";
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

export class BookingService {
  private readonly lessonFormatter = new LessonFormatService();
  private readonly pricing = new PricingService();

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly moyKlass = new MoyKlassService(),
    private readonly tbank = new TBankService()
  ) {}

  async upsertParent(input: {
    vkUserId: number;
    name?: string | null;
    phone?: string | null;
    referralPayload?: string | null;
  }) {
    return this.db.parent.upsert({
      where: { vkUserId: BigInt(input.vkUserId) },
      update: {
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        referralPayload: input.referralPayload ?? undefined,
        referralApplied: input.referralPayload ? true : undefined
      },
      create: {
        vkUserId: BigInt(input.vkUserId),
        name: input.name,
        phone: input.phone,
        referralPayload: input.referralPayload,
        referralApplied: Boolean(input.referralPayload)
      }
    });
  }

  async getAvailableLessons(branchId: string, courseCode: BotCourseCode) {
    const branch = await this.db.branch.findUniqueOrThrow({ where: { id: branchId } });
    const course = await this.db.botCourse.findUniqueOrThrow({
      where: { code: courseCode },
      include: { mapping: true }
    });
    const courseId = course.mapping?.moyklassCourseId;
    if (!courseId) throw new Error(`Course mapping for ${courseCode} is not configured`);

    const classes = await this.moyKlass.getClasses(branch.moyklassId, courseId);
    const lookupSettings = await this.getLessonLookupSettings();
    const lessons = await this.moyKlass.getLessons({
      dateFrom: lookupSettings.startDate,
      dateTo: addDays(lookupSettings.startDate, TRIAL_LOOKUP_DAYS),
      classIds: classes.map((item) => item.id)
    });

    return this.lessonFormatter.buildAvailableLessonList(lessons, {
      includeUnavailable: lookupSettings.developerMode
    });
  }

  private async getLessonLookupSettings(): Promise<{ startDate: Date; developerMode: boolean }> {
    const [developerMode, developerTodayDate] = await Promise.all([
      this.db.appSetting.findUnique({ where: { key: "developerMode" } }),
      this.db.appSetting.findUnique({ where: { key: "developerTodayDate" } })
    ]);
    const enabled = developerMode?.value === true;

    return {
      startDate: resolveTodayForDeveloperMode(enabled, developerTodayDate?.value),
      developerMode: enabled
    };
  }

  async createDraftBooking(input: BookingDraftInput) {
    const parent = await this.db.parent.findUniqueOrThrow({ where: { id: input.parentId } });
    const child = await this.db.child.create({
      data: {
        parentId: parent.id,
        name: input.childName,
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

    await this.ensureMoyKlassBookings(order.id);

    const chargedKopecks = env.PAYMENT_TEST_MODE ? 100 : order.totalKopecks;
    const payment = await this.tbank.initPayment({
      orderId: order.id,
      amountKopecks: chargedKopecks,
      description: `Пробное занятие Codorobot, ${order.items.length} дет.`,
      customerPhone: order.parent.phone,
      receiptItems: order.items.map((item) => ({
        Name: item.title,
        Price: env.PAYMENT_TEST_MODE ? Math.floor(chargedKopecks / order.items.length) : item.amountKopecks,
        Quantity: 1,
        Amount: env.PAYMENT_TEST_MODE ? Math.floor(chargedKopecks / order.items.length) : item.amountKopecks,
        Tax: "none"
      }))
    });

    return this.db.payment.upsert({
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
  }

  async markPayOnSite(orderId: string) {
    await this.ensureMoyKlassBookings(orderId);

    return this.db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.pay_on_site } });
      await tx.trialBooking.updateMany({
        where: { orderItem: { orderId } },
        data: { status: BookingStatus.pay_on_site }
      });

      return tx.payment.upsert({
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
    });
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
      await this.db.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.expired_to_pay_on_site }
      });
      await this.db.trialBooking.updateMany({
        where: { orderItem: { orderId: order.id } },
        data: { status: BookingStatus.pay_on_site }
      });
    }

    return orders.length;
  }

  async handlePaidOrder(orderId: string) {
    await this.ensureMoyKlassBookings(orderId);

    const order = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: {
          include: {
            child: true,
            booking: { include: { branch: true } }
          }
        }
      }
    });

    for (const item of order.items) {
      if (!item.child.moyklassUserId) continue;
      await this.moyKlass.createPayment({
        userId: item.child.moyklassUserId,
        filialId: item.booking.branch.moyklassId,
        summaRubles: item.amountKopecks / 100
      });
    }

    await this.db.trialBooking.updateMany({
      where: { orderItem: { orderId } },
      data: { status: BookingStatus.booked }
    });

    await this.db.payment.update({
      where: { orderId },
      data: { status: PaymentStatus.paid }
    });

    return this.db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.paid }
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

  async syncExternalRecordsForBooking(bookingId: string) {
    const item = await this.db.orderItem.findUnique({
      where: { bookingId },
      select: { orderId: true }
    });
    if (item) {
      await this.ensureMoyKlassBookings(item.orderId);
    }
  }

  private async ensureMoyKlassBookings(orderId: string) {
    const order = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        parent: true,
        items: {
          include: {
            child: true,
            booking: { include: { branch: true } }
          }
        }
      }
    });

    for (const item of order.items) {
      const booking = item.booking;
      let child = item.child;

      if (!child.moyklassUserId) {
        const createdUser = await this.moyKlass.createUser({
          childName: child.name,
          childAge: child.age,
          phone: order.parent.phone ?? "",
          parentName: order.parent.name,
          filialId: booking.branch.moyklassId
        });
        child = await this.db.child.update({
          where: { id: child.id },
          data: { moyklassUserId: createdUser.id }
        });
      }

      if (!booking.moyklassJoinId && booking.moyklassClassId) {
        const join = await this.moyKlass.createJoin({
          userId: child.moyklassUserId!,
          classId: booking.moyklassClassId,
          priceRubles: item.amountKopecks / 100
        });
        await this.db.trialBooking.update({
          where: { id: booking.id },
          data: { moyklassJoinId: join.id, status: BookingStatus.awaiting_payment }
        });
      }

      if (!booking.moyklassLessonRecordId && booking.moyklassLessonId) {
        const record = await this.moyKlass.createLessonRecord({
          userId: child.moyklassUserId!,
          lessonId: booking.moyklassLessonId
        });
        await this.db.trialBooking.update({
          where: { id: booking.id },
          data: { moyklassLessonRecordId: record.id }
        });
      }
    }

    await this.db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.awaiting_payment }
    });
  }
}
