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
    const courseUrl = stripProtocol(`${booking.branch.baseUrl}${booking.botCourse.defaultUrl}`);
    const lessonDate = booking.lessonDate
      ? `${formatRelativeLessonDate(booking.lessonDate)} в ${booking.lessonBeginTime ?? ""}`.trim()
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

}

const weekdayForms = [
  { current: "это воскресенье", next: "следующее воскресенье" },
  { current: "этот понедельник", next: "следующий понедельник" },
  { current: "этот вторник", next: "следующий вторник" },
  { current: "эту среду", next: "следующую среду" },
  { current: "этот четверг", next: "следующий четверг" },
  { current: "эту пятницу", next: "следующую пятницу" },
  { current: "эту субботу", next: "следующую субботу" }
];

function formatRelativeLessonDate(date: Date): string {
  const today = startOfDay(new Date());
  const lesson = startOfDay(date);
  const diffDays = Math.round((lesson.getTime() - today.getTime()) / 86_400_000);
  const dateText = date.toLocaleDateString("ru-RU");
  const weekday = weekdayForms[lesson.getDay()];

  if (diffDays >= 0 && diffDays <= 6) return `В ${weekday.current} (${dateText})`;
  if (diffDays >= 7 && diffDays <= 13) return `В ${weekday.next} (${dateText})`;

  return `${dateText}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}
