import type { BotCourse, Branch, Child, Payment, TrialBooking } from "@prisma/client";
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
    const courseUrl = `${booking.branch.baseUrl}${booking.botCourse.defaultUrl}`;
    const paymentStatus = this.renderPaymentStatus(booking.orderItem?.order.payment ?? null);
    const lessonDate = booking.lessonDate
      ? `${booking.lessonDate.toLocaleDateString("ru-RU")} в ${booking.lessonBeginTime ?? ""}`.trim()
      : "дата не выбрана";

    return [
      `Пробное занятие для ${booking.child.name}`,
      `Филиал: ${booking.branch.name}, ${booking.branch.address}`,
      `Курс: ${booking.botCourse.title}`,
      `Дата пробного: ${lessonDate}`,
      `Оплата: ${paymentStatus}`,
      `Описание курса: ${courseUrl}`
    ].join("\n");
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
        input.nextPaymentDate ? input.nextPaymentDate.toLocaleDateString("ru-RU") : "пока не указан"
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

  private renderPaymentStatus(payment: Payment | null): string {
    if (!payment) return "ожидает выбора способа оплаты";
    if (payment.status === "paid") return "оплачено";
    if (payment.method === "on_site") return "оплата в филиале";
    if (payment.status === "pending") return "ожидает онлайн-оплаты";
    return payment.status;
  }
}
