import type { BotCourse, Branch, Child, Payment, TrialBooking } from "@prisma/client";
import { formatMessageDate, formatMessageLessonDate } from "../lib/message-date-format.js";
import { kopecksToRubles } from "../lib/money.js";

type TrialMenuInput = TrialBooking & {
  child: Child;
  branch: Branch;
  botCourse: BotCourse;
  orderItem?: {
    amountKopecks: number;
    order: {
      payment: Payment | null;
    };
  } | null;
};

export class MenuService {
  renderTrialChild(booking: TrialMenuInput): string {
    const courseUrl = stripProtocol(`${booking.branch.baseUrl}${booking.botCourse.defaultUrl}`);
    const lessonDate = booking.lessonDate
      ? formatMessageLessonDate(booking.lessonDate, booking.lessonBeginTime)
      : "дата не выбрана";
    const payment = booking.orderItem?.order.payment ?? null;
    const lines = [
      `Пробное занятие для ${booking.child.name}`,
      `${booking.branch.name}, ${booking.branch.address}`,
      lessonDate,
      `${booking.botCourse.title} (${courseUrl})`
    ];

    if (payment?.method === "on_site" && payment.status !== "paid") {
      lines.push("Оплата в школе");
    }

    return lines.join("\n");
  }

  renderActiveStudent(input: {
    childName: string;
    courseTitle: string;
    branchName: string;
    nextPaymentDate?: Date | null;
  }): string {
    return [
      `Ученик: ${input.childName}`,
      `Курс: ${input.courseTitle}`,
      `Филиал: ${input.branchName}`,
      `Следующий платеж по абонементу: ${
        input.nextPaymentDate ? formatMessageDate(input.nextPaymentDate) : "пока не указан"
      }`
    ].join("\n");
  }

  renderOrderSummary(input: {
    items: Array<{ childName: string; courseTitle: string; amountKopecks: number }>;
    totalKopecks: number;
  }): string {
    const lines = input.items.map(
      (item, index) =>
        `${index + 1}. ${item.childName}, ${item.courseTitle}: ${kopecksToRubles(item.amountKopecks)}`
    );

    return [`Проверьте запись:`, ...lines, `Итого: ${kopecksToRubles(input.totalKopecks)}`].join("\n");
  }

}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}
