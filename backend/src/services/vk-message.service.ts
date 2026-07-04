import { Keyboard, VK } from "vk-io";
import { env } from "../config/env.js";
import { COURSE_OPTION_LABELS, TRIAL_INTRO_MESSAGES } from "../domain/catalog.js";
import type { CourseOption } from "./course-router.service.js";
import { VkEventLogService } from "./vk-event-log.service.js";

type Button = {
  label: string;
  payload?: Record<string, unknown>;
  color?: "primary" | "secondary" | "positive" | "negative";
};

const MESSAGE_CHAIN_DELAY_MS = 2_000;

export class VkMessageService {
  private static readonly peerSendQueues = new Map<number, Promise<void>>();
  private static readonly peerLastSentAt = new Map<number, number>();

  private readonly vk = new VK({ token: env.VK_GROUP_TOKEN || "not-configured" });
  private readonly log = new VkEventLogService();

  async sendText(peerId: number, message: string): Promise<void> {
    await this.send(peerId, message);
  }

  async sendKeyboard(peerId: number, message: string, buttons: Button[]): Promise<void> {
    await this.send(peerId, message, this.buildKeyboard(buttons));
  }

  async sendInlineKeyboard(peerId: number, message: string, buttons: Button[]): Promise<void> {
    await this.send(peerId, message, this.buildKeyboard(buttons, true));
  }

  async sendTrialIntro(peerId: number): Promise<void> {
    for (const message of TRIAL_INTRO_MESSAGES) {
      await this.sendText(peerId, message);
    }
  }

  async sendCourseOptions(peerId: number, age: number, options: CourseOption[]): Promise<void> {
    await this.sendKeyboard(
      peerId,
      "Какое направление Вас интересует?",
      options.map((option) => ({
        label: option.label,
        payload: { action: "course_option", option: option.key, age },
        color: "primary"
      }))
    );
  }

  async sendCourseOptionsWithEdits(
    peerId: number,
    age: number,
    options: CourseOption[],
    editButtons: Button[]
  ): Promise<void> {
    await this.sendKeyboard(
      peerId,
      "Какое направление Вас интересует?",
      [
        ...options.map((option) => ({
          label: option.label,
          payload: { action: "course_option", option: option.key, age },
          color: "primary" as const
        })),
        ...editButtons
      ]
    );
  }

  async sendSubCourseOptions(
    peerId: number,
    options: Array<{ key: string; label: string }>,
    age: number,
    primaryOption: string
  ): Promise<void> {
    await this.sendKeyboard(
      peerId,
      "Уточните направление:",
      options.map((option) => ({
        label: option.label,
        payload: {
          action: "course_subchoice",
          option: primaryOption,
          subChoice: option.key,
          age
        },
        color: "primary"
      }))
    );
  }

  async sendBranchOptions(
    peerId: number,
    branches: Array<{ id: string; name: string }>,
    editButtons: Button[] = []
  ): Promise<void> {
    await this.sendKeyboard(
      peerId,
      "По какому адресу Вам удобнее будет нас посетить?",
      [
        ...branches.map((branch) => ({
          label: branch.name,
          payload: { action: "branch", branchId: branch.id },
          color: "secondary" as const
        })),
        ...editButtons
      ]
    );
  }

  async sendBranchOptionsWithInlineEdits(
    peerId: number,
    branches: Array<{ id: string; name: string }>,
    editButtons: Button[]
  ): Promise<void> {
    await this.sendInlineKeyboard(
      peerId,
      "По какому адресу Вам удобнее будет нас посетить?",
      editButtons
    );
    await this.sendKeyboard(
      peerId,
      "Выберите филиал:",
      branches.map((branch) => ({
        label: branch.name,
        payload: { action: "branch", branchId: branch.id },
        color: "secondary" as const
      }))
    );
  }

  async sendMainMenu(peerId: number): Promise<void> {
    await this.sendKeyboard(peerId, "Главное меню", [
      { label: "Мои дети", payload: { action: "children" }, color: "primary" }
    ]);
  }

  buildCourseConfirmButtons() {
    return [
      {
        label: "Нет, выбрать другой курс",
        payload: { action: "course_confirm", accepted: false },
        color: "negative"
      },
      { label: "Да, записываем", payload: { action: "course_confirm", accepted: true }, color: "positive" }
    ] satisfies Button[];
  }

  buildEditButtons(fields: Array<{ field: string; label: string }>): Button[] {
    return fields.map((item) => ({
      label: item.label,
      payload: { action: "edit_field", field: item.field },
      color: "secondary" as const
    }));
  }

  buildCancelAdditionalChildButtons(): Button[] {
    return [
      {
        label: "Отмена",
        payload: { action: "cancel_add_child" },
        color: "negative"
      }
    ];
  }

  buildLessonButtons(
    lessons: Array<{ id: number; classId: number }>,
    options: { withDraftChangeActions?: boolean; withCancelReschedule?: boolean } = {}
  ) {
    const buttons: Button[] = lessons.map((lesson, index) => ({
      label: String(index + 1),
      payload: { action: "lesson", lessonId: lesson.id, classId: lesson.classId },
      color: "primary" as const
    }));

    if (options.withDraftChangeActions) {
      buttons.push(
        { label: "др. филиал", payload: { action: "lesson_change_branch" }, color: "secondary" },
        { label: "др. курс", payload: { action: "lesson_change_course" }, color: "secondary" }
      );
    }

    if (options.withCancelReschedule) {
      buttons.push({
        label: "Отмена",
        payload: { action: "cancel_reschedule" },
        color: "negative"
      });
    }

    return buttons;
  }

  buildRetryLessonsButtons() {
    return [
      {
        label: "Проверить еще раз",
        payload: { action: "retry_lessons" },
        color: "primary" as const
      }
    ];
  }

  buildPaymentButtons(orderId: string) {
    const buttons: Button[] = [];
    buttons.push({ label: "В школе", payload: { action: "pay_on_site", orderId }, color: "secondary" });
    buttons.push({ label: "Карта/QR онлайн", payload: { action: "pay_online", orderId }, color: "positive" });
    return buttons;
  }

  buildTrialMenuButtons(bookingId: string, options: { onlinePaymentOrderId?: string } = {}) {
    const buttons: Button[] = [
      { label: "Перенести запись", payload: { action: "choose_change_booking" }, color: "primary" },
      { label: "Когда моя запись", payload: { action: "booking_details", bookingId }, color: "secondary" },
      { label: "Записать еще одного ребенка", payload: { action: "add_child" }, color: "positive" }
    ];

    if (options.onlinePaymentOrderId) {
      buttons.push({
        label: "Оплатить онлайн",
        payload: { action: "pay_online", orderId: options.onlinePaymentOrderId },
        color: "positive"
      });
    }

    return buttons;
  }

  buildTrialRootMenuButtons(options: { onlinePaymentOrderId?: string } = {}) {
    const buttons: Button[] = [
      { label: "Перенести запись", payload: { action: "choose_change_booking" }, color: "primary" },
      { label: "Когда моя запись", payload: { action: "booking_details" }, color: "secondary" },
      { label: "Записать еще одного ребенка", payload: { action: "add_child" }, color: "positive" }
    ];

    if (options.onlinePaymentOrderId) {
      buttons.push({
        label: "Оплатить онлайн",
        payload: { action: "pay_online", orderId: options.onlinePaymentOrderId },
        color: "positive"
      });
    }

    return buttons;
  }

  buildRescheduleBookingButtons(bookings: Array<{ id: string }>): Button[] {
    return [
      ...bookings.map((booking, index) => ({
        label: String(index + 1),
        payload: { action: "change_booking_choice", bookingId: booking.id },
        color: "primary" as const
      })),
      {
        label: "Отмена",
        payload: { action: "cancel_reschedule" },
        color: "negative" as const
      }
    ];
  }

  private buildKeyboard(buttons: Button[], inline = false) {
    const builder = Keyboard.builder();
    if (inline) builder.inline();
    buttons.forEach((button, index) => {
      if (index > 0 && index % 2 === 0) builder.row();
      builder.textButton({
        label: button.label,
        payload: button.payload ?? {},
        color: button.color ?? "secondary"
      });
    });
    return inline ? builder : builder.oneTime();
  }

  private async send(peerId: number, message: string, keyboard?: ReturnType<VkMessageService["buildKeyboard"]>) {
    const previous = VkMessageService.peerSendQueues.get(peerId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.sendQueued(peerId, message, keyboard));

    VkMessageService.peerSendQueues.set(
      peerId,
      next.finally(() => {
        if (VkMessageService.peerSendQueues.get(peerId) === next) {
          VkMessageService.peerSendQueues.delete(peerId);
        }
      })
    );

    await next;
  }

  private async sendQueued(peerId: number, message: string, keyboard?: ReturnType<VkMessageService["buildKeyboard"]>) {
    await this.waitForMessageGap(peerId);

    await this.log.write("vk_send", {
      peerId,
      message,
      hasKeyboard: Boolean(keyboard)
    });

    if (!env.VK_GROUP_TOKEN) {
      console.log("[vk:dry-run]", { peerId, message, keyboard: keyboard?.toString() });
      return;
    }

    await this.vk.api.messages.send({
      peer_id: peerId,
      random_id: Date.now() + Math.floor(Math.random() * 1000),
      message,
      keyboard
    });

    VkMessageService.peerLastSentAt.set(peerId, Date.now());
  }

  private async waitForMessageGap(peerId: number) {
    const lastSentAt = VkMessageService.peerLastSentAt.get(peerId);
    if (!lastSentAt) return;

    const delayMs = MESSAGE_CHAIN_DELAY_MS - (Date.now() - lastSentAt);
    if (delayMs > 0) await sleep(delayMs);
  }
}

export function labelToPrimaryCourseOption(label: string) {
  return Object.entries(COURSE_OPTION_LABELS).find(([, value]) => value === label)?.[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
