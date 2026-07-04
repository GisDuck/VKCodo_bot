import { BookingStatus, PrismaClient, type Payment } from "@prisma/client";
import { addDays } from "../lib/dates.js";
import { resolveTodayForDeveloperMode } from "../lib/developer-date.js";
import { prisma } from "../lib/prisma.js";
import { MenuService } from "./menu.service.js";
import { VkMessageService } from "./vk-message.service.js";

const REMINDER_TYPE = "trial_day_before";

export class TrialReminderService {
  private readonly menu = new MenuService();
  private readonly messages = new VkMessageService();

  constructor(private readonly db: PrismaClient = prisma) {}

  async sendTomorrowTrialReminders() {
    const today = await this.getReminderToday();
    const targetDate = startOfUtcDay(addDays(today, 1));
    const nextDate = addDays(targetDate, 1);

    const bookings = await this.db.trialBooking.findMany({
      where: {
        status: { in: [BookingStatus.awaiting_payment, BookingStatus.pay_on_site, BookingStatus.booked] },
        lessonDate: {
          gte: targetDate,
          lt: nextDate
        },
        reminderLogs: {
          none: {
            type: REMINDER_TYPE,
            targetDate
          }
        }
      },
      include: {
        child: { include: { parent: true } },
        branch: true,
        botCourse: true,
        orderItem: { include: { order: { include: { payment: true } } } }
      },
      orderBy: [{ lessonDate: "asc" }, { lessonBeginTime: "asc" }]
    });

    let sent = 0;
    const menuBookingsByVkUserId = new Map<number, typeof bookings>();
    for (const booking of bookings) {
      const vkUserId = Number(booking.child.parent.vkUserId);
      await this.messages.sendText(vkUserId, `Напоминаем о пробном занятии завтра\n\n${this.menu.renderTrialChild(booking)}`);
      menuBookingsByVkUserId.set(vkUserId, [...(menuBookingsByVkUserId.get(vkUserId) ?? []), booking]);

      await this.db.trialReminderLog.create({
        data: {
          bookingId: booking.id,
          type: REMINDER_TYPE,
          targetDate
        }
      });
      sent += 1;
    }

    for (const [vkUserId, reminderBookings] of menuBookingsByVkUserId) {
      await this.messages.sendKeyboard(
        vkUserId,
        "Меню",
        this.messages.buildTrialRootMenuButtons(this.getTrialRootMenuOptions(reminderBookings))
      );
    }

    return {
      checkedDate: toIsoDate(today),
      targetDate: toIsoDate(targetDate),
      found: bookings.length,
      sent
    };
  }

  private async getReminderToday(): Promise<Date> {
    const [developerMode, developerTodayDate] = await Promise.all([
      this.db.appSetting.findUnique({ where: { key: "developerMode" } }),
      this.db.appSetting.findUnique({ where: { key: "developerTodayDate" } })
    ]);

    return startOfUtcDay(
      resolveTodayForDeveloperMode(developerMode?.value === true, developerTodayDate?.value)
    );
  }

  private getTrialRootMenuOptions(bookings: Array<{
    orderItem?: { orderId?: string; order: { payment: Payment | null } } | null;
  }>): { onlinePaymentOrderId?: string } {
    const booking = bookings.find((item) => {
      const payment = item.orderItem?.order.payment ?? null;
      return item.orderItem?.orderId && payment?.method === "on_site" && payment.status !== "paid";
    });

    return booking?.orderItem?.orderId ? { onlinePaymentOrderId: booking.orderItem.orderId } : {};
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
