import { BotCourseCode, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { PrimaryCourseOption, SubCourseOption } from "../domain/catalog.js";
import { CourseRouterService } from "./course-router.service.js";
import { BookingService } from "./booking.service.js";
import { MenuService } from "./menu.service.js";
import { VkEventLogService } from "./vk-event-log.service.js";
import { VkMessageService } from "./vk-message.service.js";
import { formatDate, getWeekdayName } from "./lesson-format.service.js";
import { isRetryableExternalError, withExternalApiRetry } from "../lib/external-retry.js";

type VkIncomingUpdate = {
  type?: string;
  event_id?: string;
  group_id?: number;
  object?: {
    message?: {
      id?: number;
      conversation_message_id?: number;
      from_id: number;
      peer_id: number;
      date?: number;
      text?: string;
      payload?: string | Record<string, unknown>;
      ref?: string;
    };
  };
};

type DraftChild = {
  name?: string;
  age?: number;
  branchId?: string;
  courseCode?: BotCourseCode;
};

type SessionDraft = {
  parentName?: string;
  phone?: string;
  childrenCount?: number;
  currentIndex?: number;
  currentChild?: DraftChild;
  bookingIds?: string[];
  orderId?: string;
  paymentChoiceIsYanino?: boolean;
  changeBookingId?: string;
  changeCourseCode?: BotCourseCode;
  availableLessons?: Array<{ id: number; classId: number; date: string; beginTime: string }>;
  selectedOption?: string;
};

export class VkBotService {
  private readonly courseRouter = new CourseRouterService();
  private readonly messages = new VkMessageService();
  private readonly booking = new BookingService();
  private readonly menu = new MenuService();
  private readonly log = new VkEventLogService();
  private readonly processedEvents = new Map<string, number>();
  private readonly userQueues = new Map<number, Promise<void>>();

  constructor(private readonly db: PrismaClient = prisma) {}

  async handleUpdate(update: VkIncomingUpdate): Promise<void> {
    if (update.type !== "message_new") return;

    const message = update.object?.message;
    if (!message?.from_id || !message.peer_id) return;

    const eventKey = this.getEventKey(update);
    if (this.isDuplicate(eventKey)) {
      await this.log.write("duplicate_skipped", {
        eventKey,
        fromId: message.from_id,
        peerId: message.peer_id,
        text: message.text,
        payload: message.payload
      });
      return;
    }

    const previous = this.userQueues.get(message.from_id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.processUpdate(update, eventKey));

    this.userQueues.set(
      message.from_id,
      next.finally(() => {
        if (this.userQueues.get(message.from_id) === next) {
          this.userQueues.delete(message.from_id);
        }
      })
    );

    await next;
  }

  private async processUpdate(update: VkIncomingUpdate, eventKey: string): Promise<void> {
    const startedAt = Date.now();
    const message = update.object!.message!;
    const payload = this.parsePayload(message.payload);
    const text = (message.text ?? "").trim();
    const parent = await this.booking.upsertParent({
      vkUserId: message.from_id,
      referralPayload: message.ref ?? this.readString(payload.ref)
    });
    const session = await this.getSession(parent.id);
    const draft = this.toDraft(session.draft);

    await this.log.write("message_processing_start", {
      eventKey,
      fromId: message.from_id,
      peerId: message.peer_id,
      messageId: message.id,
      conversationMessageId: message.conversation_message_id,
      text,
      payload,
      stateBefore: session.state,
      draftBefore: draft
    });

    let stateAfter = session.state;
    try {
      if (payload.action === "start_trial") {
        if (session.state !== "idle") {
          await this.messages.sendText(message.peer_id, "Продолжим с текущего шага.");
          return;
        }
        stateAfter = await this.handleIdleState(parent.id, message.peer_id);
        return;
      }

      if (payload.action === "children") {
        if (session.state !== "idle") {
          await this.messages.sendText(message.peer_id, "Продолжим с текущего шага.");
          return;
        }
        stateAfter = await this.handleIdleState(parent.id, message.peer_id);
        return;
      }

      if (payload.action === "edit_field" && typeof payload.field === "string") {
        if (!this.isEditFieldAllowed(session.state, payload.field)) {
          await this.messages.sendText(message.peer_id, "Эта кнопка уже устарела. Продолжим с текущего шага.");
          return;
        }
        await this.handleEditField(parent.id, message.peer_id, draft, payload.field);
        return;
      }

      if (payload.action === "retry_lessons") {
        await this.handleRetryLessons(parent.id, message.peer_id, session.state, draft);
        return;
      }

      if (payload.action === "pay_online" && typeof payload.orderId === "string") {
        await this.handleOnlinePayment(message.peer_id, payload.orderId);
        return;
      }

      if (payload.action === "pay_on_site" && typeof payload.orderId === "string") {
        await this.handlePayOnSite(parent.id, message.peer_id, payload.orderId);
        return;
      }

      if (payload.action === "cancel_booking" && typeof payload.bookingId === "string") {
        await this.handleCancelBooking(message.peer_id, payload.bookingId);
        return;
      }

      if (payload.action === "change_booking") {
        await this.messages.sendKeyboard(message.peer_id, "Что хотите изменить?", [
          {
            label: "Курс",
            payload: { action: "change_course", bookingId: payload.bookingId },
            color: "primary"
          },
          {
            label: "Дату",
            payload: { action: "change_date", bookingId: payload.bookingId },
            color: "primary"
          }
        ]);
        return;
      }

      if (payload.action === "change_course" || payload.action === "change_date") {
        if (payload.action === "change_course" && typeof payload.bookingId === "string") {
          await this.handleChangeCourseStart(parent.id, message.peer_id, payload.bookingId);
          return;
        }
        if (payload.action === "change_date" && typeof payload.bookingId === "string") {
          await this.handleChangeDateStart(parent.id, message.peer_id, payload.bookingId);
          return;
        }
        return;
      }

      stateAfter = await this.handleState(parent.id, message.peer_id, session.state, draft, text, payload);
    } catch (error) {
      await this.log.write("message_processing_error", {
        eventKey,
        fromId: message.from_id,
        peerId: message.peer_id,
        stateBefore: session.state,
        error: this.errorMessage(error)
      });
      await this.messages.sendText(message.peer_id, "Не получилось обработать сообщение. Я уже записал ошибку в лог.");
      throw error;
    } finally {
      const freshSession = await this.getSession(parent.id);
      await this.log.write("message_processing_finish", {
        eventKey,
        fromId: message.from_id,
        peerId: message.peer_id,
        durationMs: Date.now() - startedAt,
        stateBefore: session.state,
        stateAfter: freshSession.state ?? stateAfter,
        draftAfter: freshSession.draft
      });
    }
  }

  private async handleState(
    parentId: string,
    peerId: number,
    state: string,
    draft: SessionDraft,
    text: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    switch (state) {
      case "idle":
        return this.handleIdleState(parentId, peerId);
      case "awaiting_parent_name":
        await this.handleParentName(parentId, peerId, draft, text);
        return "awaiting_phone";
      case "awaiting_phone":
        await this.handlePhone(parentId, peerId, draft, text);
        return "awaiting_children_count";
      case "awaiting_children_count":
        await this.handleChildrenCount(parentId, peerId, draft, text);
        return "awaiting_child_name";
      case "awaiting_child_name":
        await this.handleChildName(parentId, peerId, draft, text);
        return "awaiting_child_age";
      case "awaiting_child_age":
        await this.handleChildAge(parentId, peerId, draft, text);
        return "awaiting_branch";
      case "awaiting_branch":
        await this.handleBranch(parentId, peerId, draft, payload, text);
        return "awaiting_course";
      case "awaiting_course":
        await this.handleCourse(parentId, peerId, draft, payload, text);
        return "awaiting_course_confirm";
      case "awaiting_course_confirm":
        await this.handleCourseConfirm(parentId, peerId, draft, payload, text);
        return "awaiting_lesson";
      case "awaiting_lesson":
        await this.handleLesson(parentId, peerId, draft, payload, text);
        return "order_ready";
      case "change_course_select":
        await this.handleChangeCourseSelection(parentId, peerId, draft, payload, text);
        return "change_course_confirm";
      case "change_course_confirm":
        await this.handleChangeCourseConfirm(parentId, peerId, draft, payload, text);
        return "change_lesson_select";
      case "change_lesson_select":
        await this.handleChangeLessonSelection(parentId, peerId, draft, payload, text);
        return "idle";
      case "order_ready":
        await this.repeatPaymentChoice(parentId, peerId, draft);
        return state;
      default:
        await this.setSession(parentId, "idle", {});
        return this.handleIdleState(parentId, peerId);
    }
  }

  private async handleIdleState(parentId: string, peerId: number): Promise<string> {
    if (await this.hasVisibleChildrenMenu(parentId)) {
      await this.renderChildrenMenu(parentId, peerId);
      return "idle";
    }

    await this.startTrial(parentId, peerId);
    return "awaiting_parent_name";
  }

  private async startTrial(parentId: string, peerId: number) {
    await this.setSession(parentId, "awaiting_parent_name", {});
    await this.messages.sendText(
      peerId,
      "Вас приветствует Бот школы Кодология во Всеволожске и Янино! Давайте познакомимся, как Вас зовут?"
    );
  }

  private async hasVisibleChildrenMenu(parentId: string): Promise<boolean> {
    const count = await this.db.trialBooking.count({
      where: { child: { parentId }, status: { not: "cancelled" } }
    });
    return count > 0;
  }

  private async handleParentName(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    if (!text) {
      await this.messages.sendText(peerId, "Напишите, пожалуйста, имя родителя.");
      return;
    }
    draft.parentName = text;
    await this.db.parent.update({ where: { id: parentId }, data: { name: text } });
    await this.setSession(parentId, "awaiting_phone", draft);
    await this.messages.sendInlineKeyboard(
      peerId,
      `${text}, приятно познакомиться! Подскажите, пожалуйста, номер телефона для записи.`,
      this.buildEditButtons(draft, ["parentName"])
    );
  }

  private async handleEditField(parentId: string, peerId: number, draft: SessionDraft, field: string) {
    switch (field) {
      case "parentName":
        await this.setSession(parentId, "awaiting_parent_name", draft);
        await this.messages.sendText(peerId, "Хорошо, как Вас зовут?");
        return;
      case "phone":
        await this.setSession(parentId, "awaiting_phone", draft);
        await this.messages.sendText(peerId, "Напишите новый номер телефона для записи.");
        return;
      case "childrenCount":
        await this.setSession(parentId, "awaiting_children_count", draft);
        await this.messages.sendText(
          peerId,
          "Сколько детей вы хотите записать на занятие? Мы будем записывать их по очереди (до 5)"
        );
        return;
      case "childName":
        await this.setSession(parentId, "awaiting_child_name", draft);
        await this.messages.sendText(
          peerId,
          draft.childrenCount === 1 ? "Как зовут вашего ребенка?" : "Как зовут ребенка?"
        );
        return;
      case "childAge":
        await this.setSession(parentId, "awaiting_child_age", draft);
        await this.messages.sendText(
          peerId,
          draft.currentChild?.name
            ? `${draft.currentChild.name} найдет много интересного в нашей школе! А сколько ему/ей лет?`
            : "Сколько лет ребенку?"
        );
        return;
      case "branch": {
        await this.setSession(parentId, "awaiting_branch", draft);
        const branches = await this.db.branch.findMany({ where: { active: true }, orderBy: { name: "asc" } });
        await this.messages.sendBranchOptions(
          peerId,
          branches
        );
        return;
      }
      default:
        await this.messages.sendText(peerId, "Не понял, что нужно изменить.");
    }
  }

  private async handlePhone(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    const phoneDigits = text.replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 12) {
      await this.messages.sendText(peerId, "Похоже, в телефоне ошибка. Напишите номер еще раз, например +79991234567.");
      return;
    }
    draft.phone = text;
    await this.db.parent.update({ where: { id: parentId }, data: { phone: text } });
    await this.setSession(parentId, "awaiting_children_count", draft);
    await this.messages.sendInlineKeyboard(
      peerId,
      "Сколько детей вы хотите записать на занятие? Мы будем записывать их по очереди (до 5)",
      this.buildEditButtons(draft, ["phone"])
    );
  }

  private async handleChildrenCount(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    const count = Number.parseInt(text, 10);
    if (!Number.isInteger(count) || count < 1 || count > 5) {
      await this.messages.sendText(peerId, "Напишите число детей от 1 до 5.");
      return;
    }
    draft.childrenCount = count;
    draft.currentIndex = 0;
    draft.bookingIds = [];
    draft.currentChild = {};
    await this.setSession(parentId, "awaiting_child_name", draft);
    await this.messages.sendInlineKeyboard(
      peerId,
      count === 1
        ? `${draft.parentName ?? ""}, приятно познакомиться! Как зовут вашего ребенка?`.trim()
        : `${draft.parentName ?? ""}, приятно познакомиться! Как зовут первого ребенка?`.trim(),
      this.buildEditButtons(draft, ["childrenCount"])
    );
  }

  private async handleChildName(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    if (!text) {
      await this.messages.sendText(peerId, "Напишите имя ребенка.");
      return;
    }
    draft.currentChild = { name: text };
    await this.setSession(parentId, "awaiting_child_age", draft);
    await this.messages.sendInlineKeyboard(
      peerId,
      `${text} найдет много интересного в нашей школе! А сколько ему/ей лет?`,
      this.buildEditButtons(draft, ["childName"])
    );
  }

  private async handleChildAge(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    const age = Number.parseInt(text, 10);
    if (!Number.isInteger(age) || age < 5 || age > 17) {
      await this.messages.sendText(peerId, "Пока пробные занятия доступны для возраста от 5 до 17 лет.");
      return;
    }

    draft.currentChild = { ...(draft.currentChild ?? {}), age };
    await this.setSession(parentId, "awaiting_branch", draft);

    await this.messages.sendTrialIntro(peerId);
    const branches = await this.db.branch.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    await this.messages.sendBranchOptions(
      peerId,
      branches
    );
  }

  private async handleBranch(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    let branchId = typeof payload.branchId === "string" ? payload.branchId : undefined;
    if (!branchId && text) {
      const branch = await this.db.branch.findFirst({ where: { name: { equals: text, mode: "insensitive" } } });
      branchId = branch?.id;
    }

    if (!branchId) {
      await this.messages.sendText(peerId, "Выберите филиал кнопкой.");
      return;
    }

    draft.currentChild = { ...(draft.currentChild ?? {}), branchId };
    await this.setSession(parentId, "awaiting_course", draft);
    const age = draft.currentChild.age;
    if (!age) return;
    await this.messages.sendCourseOptions(
      peerId,
      age,
      this.courseRouter.getAvailableOptions(age)
    );
  }

  private async handleCourse(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    const age = draft.currentChild?.age;
    const option = this.resolvePrimaryOption(payload, text);
    if (!age || !option) {
      await this.messages.sendText(peerId, "Выберите курс кнопкой.");
      return;
    }

    const resolution = this.courseRouter.resolveCourse(age, option);
    if (resolution.kind === "needs_subchoice") {
      draft.selectedOption = option;
      await this.setSession(parentId, "awaiting_course", draft);
      await this.messages.sendSubCourseOptions(peerId, resolution.options, age, option);
      return;
    }

    await this.setCourseAndAskConfirm(parentId, peerId, draft, resolution.courseCode);
  }

  private async handleCourseConfirm(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    if (payload.action === "course_subchoice") {
      const age = draft.currentChild?.age;
      const option = draft.selectedOption;
      const subChoice = typeof payload.subChoice === "string" ? (payload.subChoice as SubCourseOption) : undefined;
      if (!age || !option || !subChoice) return;
      const resolution = this.courseRouter.resolveCourse(age, option as PrimaryCourseOption, subChoice);
      if (resolution.kind === "course") {
        await this.setCourseAndAskConfirm(parentId, peerId, draft, resolution.courseCode);
      }
      return;
    }

    const accepted = this.resolveCourseConfirm(payload, text);
    if (accepted === null) {
      await this.messages.sendText(peerId, "Подтвердите курс кнопкой.");
      return;
    }

    if (!accepted) {
      await this.setSession(parentId, "awaiting_course", draft);
      const age = draft.currentChild?.age;
      if (age) await this.messages.sendCourseOptions(peerId, age, this.courseRouter.getAvailableOptions(age));
      return;
    }

    const branchId = draft.currentChild?.branchId;
    const courseCode = draft.currentChild?.courseCode;
    if (!branchId || !courseCode) {
      await this.messages.sendText(peerId, "Не вижу филиал или курс. Давайте выберем заново.");
      await this.setSession(parentId, "awaiting_branch", draft);
      return;
    }

    try {
      const list = await this.runInteractiveExternalRequest(peerId, () =>
        this.booking.getAvailableLessons(branchId, courseCode)
      );
      draft.availableLessons = list.lessons;
      await this.setSession(parentId, "awaiting_lesson", draft);
      if (list.lessons.length === 0) {
        await this.sendNoLessonsMessage(peerId);
        return;
      }
      await this.messages.sendKeyboard(peerId, list.lessonsText, this.messages.buildLessonButtons(list.lessons));
    } catch (error) {
      await this.handleInteractiveExternalFailure(peerId, error, () => this.sendRetryLessonsMessage(peerId));
    }
  }

  private async handleLesson(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    const lessonId = this.resolveLessonId(payload, text, draft.availableLessons);
    if (!lessonId) {
      await this.resendLessonOptions(peerId, draft, "Выберите дату кнопкой с номером.");
      return;
    }

    const selected = draft.availableLessons?.find((lesson) => lesson.id === lessonId);
    const child = draft.currentChild;
    if (!selected || !child?.name || !child.age || !child.branchId || !child.courseCode) {
      await this.messages.sendText(peerId, "Не хватает данных для записи. Начнем заново.");
      await this.setSession(parentId, "idle", {});
      return;
    }

    const booking = await this.booking.createDraftBooking({
      parentId,
      childName: child.name,
      childAge: child.age,
      branchId: child.branchId,
      botCourseCode: child.courseCode,
      lesson: {
        lessonId: selected.id,
        classId: selected.classId,
        date: selected.date,
        beginTime: selected.beginTime
      }
    });

    draft.bookingIds = [...(draft.bookingIds ?? []), booking.id];
    draft.currentIndex = (draft.currentIndex ?? 0) + 1;
    draft.currentChild = {};
    draft.availableLessons = [];

    if ((draft.currentIndex ?? 0) < (draft.childrenCount ?? 1)) {
      await this.setSession(parentId, "awaiting_child_name", draft);
      await this.messages.sendText(peerId, `Записали ${booking.child.name}. Как зовут следующего ребенка?`);
      return;
    }

    const order = await this.booking.createOrderFromBookings(parentId, draft.bookingIds);
    const summary = this.menu.renderOrderSummary({
      items: order.items.map((item) => ({
        childName: item.child.name,
        courseTitle: item.booking.botCourse.title,
        amountKopecks: item.amountKopecks
      })),
      totalKopecks: order.totalKopecks
    });

    await this.setSession(parentId, "order_ready", {
      bookingIds: draft.bookingIds,
      orderId: order.id,
      paymentChoiceIsYanino: order.items.every((item) => item.booking.branch.code === "YANINO")
    });
    await this.messages.sendText(peerId, summary);
    await this.messages.sendKeyboard(
      peerId,
      this.buildPaymentChoiceMessage(order.items.every((item) => item.booking.branch.code === "YANINO")),
      this.messages.buildPaymentButtons(order.id)
    );
  }

  private async setCourseAndAskConfirm(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    courseCode: BotCourseCode
  ) {
    const course = await this.db.botCourse.findUniqueOrThrow({ where: { code: courseCode } });
    const branch = await this.db.branch.findUniqueOrThrow({ where: { id: draft.currentChild?.branchId } });
    draft.currentChild = { ...(draft.currentChild ?? {}), courseCode };
    await this.setSession(parentId, "awaiting_course_confirm", draft);

    await this.messages.sendText(peerId, `${draft.parentName ?? "Здравствуйте"}, рекомендуем вам курс ${course.title}!`);
    await this.messages.sendText(peerId, course.description);
    await this.messages.sendText(
      peerId,
      `Полное описание программы и модулей вы сможете найти по ссылке ниже:\n${branch.baseUrl}${course.defaultUrl}`
    );
    await this.messages.sendKeyboard(peerId, "Устраивает ли вас курс?", this.messages.buildCourseConfirmButtons());
  }

  private buildPaymentChoiceMessage(isYanino: boolean): string {
    if (isYanino) {
      return "Выберите способ оплаты: В школе можно оплатить наличными, картой, СБП, QR. А онлайн мы принимаем карту, СБП, QR.";
    }

    return "Выберите способ оплаты: В школе можно оплатить наличными. А онлайн мы принимаем карту, СБП, QR.";
  }

  private async resendLessonOptions(peerId: number, draft: SessionDraft, message: string) {
    const lessons = draft.availableLessons ?? [];
    if (lessons.length === 0) {
      await this.sendNoLessonsMessage(peerId);
      return;
    }

    await this.messages.sendKeyboard(
      peerId,
      `${message}\n\n${this.formatLessonOptions(lessons)}`,
      this.messages.buildLessonButtons(lessons)
    );
  }

  private formatLessonOptions(lessons: Array<{ date: string; beginTime: string }>): string {
    return lessons
      .map((lesson, index) => `${index + 1}. ${formatDate(lesson.date)} в ${lesson.beginTime} ${getWeekdayName(lesson.date)}`)
      .join("\n");
  }

  private async handleOnlinePayment(peerId: number, orderId: string) {
    try {
      const payment = await this.runInteractiveExternalRequest(peerId, () => this.booking.initOnlinePayment(orderId));
      await this.messages.sendKeyboard(peerId, `Ссылка на оплату:\n${payment?.paymentUrl ?? ""}`, [
        { label: "В школе", payload: { action: "pay_on_site", orderId }, color: "secondary" }
      ]);
    } catch (error) {
      await this.handleInteractiveExternalFailure(peerId, error, async () => {
        const choice = await this.getPaymentChoice(orderId);
        await this.messages.sendKeyboard(
          peerId,
          this.buildPaymentChoiceMessage(choice.isYanino),
          this.messages.buildPaymentButtons(orderId)
        );
      });
    }
  }

  private async handlePayOnSite(parentId: string, peerId: number, orderId: string) {
    try {
      await this.booking.markPayOnSite(orderId);
      await this.setSession(parentId, "idle", {});
      await this.messages.sendText(
        peerId,
        "Спасибо! Ваша запись принята. Мы ждём вас на пробном занятии. Оплатить занятие можно будет в школе."
      );
      await this.renderChildrenMenu(parentId, peerId);
    } catch (error) {
      await this.messages.sendText(peerId, `Не удалось подтвердить оплату в филиале: ${this.errorMessage(error)}`);
    }
  }

  private async handleCancelBooking(peerId: number, bookingId: string) {
    try {
      await this.booking.cancelBooking(bookingId);
      await this.messages.sendText(peerId, "Запись отменена.");
    } catch (error) {
      await this.messages.sendText(peerId, `Не удалось отменить запись: ${this.errorMessage(error)}`);
    }
  }

  private async handleChangeCourseStart(parentId: string, peerId: number, bookingId: string) {
    const booking = await this.db.trialBooking.findFirstOrThrow({
      where: { id: bookingId, child: { parentId } },
      include: { child: true }
    });
    const age = booking.child.age;
    if (!age) {
      await this.messages.sendText(peerId, "Для смены курса не хватает возраста ребенка.");
      return;
    }
    await this.setSession(parentId, "change_course_select", { changeBookingId: bookingId });
    await this.messages.sendCourseOptions(peerId, age, this.courseRouter.getAvailableOptions(age));
  }

  private async handleChangeDateStart(parentId: string, peerId: number, bookingId: string) {
    const booking = await this.db.trialBooking.findFirstOrThrow({
      where: { id: bookingId, child: { parentId } },
      include: { botCourse: true }
    });
    await this.askChangeLesson(parentId, peerId, booking.id, booking.botCourse.code);
  }

  private async handleChangeCourseSelection(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    const booking = await this.db.trialBooking.findFirstOrThrow({
      where: { id: draft.changeBookingId, child: { parentId } },
      include: { child: true }
    });
    const age = booking.child.age;
    if (payload.action === "course_subchoice") {
      const option = draft.selectedOption;
      const subChoice = typeof payload.subChoice === "string" ? (payload.subChoice as SubCourseOption) : undefined;
      if (!age || !option || !subChoice) return;
      const resolution = this.courseRouter.resolveCourse(age, option as PrimaryCourseOption, subChoice);
      if (resolution.kind === "course") {
        await this.askChangeCourseConfirm(parentId, peerId, draft.changeBookingId!, resolution.courseCode);
      }
      return;
    }

    const option = this.resolvePrimaryOption(payload, text);
    if (!age || !option) {
      await this.messages.sendText(peerId, "Выберите новый курс кнопкой.");
      return;
    }

    const resolution = this.courseRouter.resolveCourse(age, option);
    if (resolution.kind === "needs_subchoice") {
      await this.setSession(parentId, "change_course_select", {
        ...draft,
        selectedOption: option
      });
      await this.messages.sendSubCourseOptions(peerId, resolution.options, age, option);
      return;
    }

    await this.askChangeCourseConfirm(parentId, peerId, draft.changeBookingId!, resolution.courseCode);
  }

  private async handleChangeCourseConfirm(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    if (payload.action === "course_subchoice") {
      const booking = await this.db.trialBooking.findFirstOrThrow({
        where: { id: draft.changeBookingId, child: { parentId } },
        include: { child: true }
      });
      const age = booking.child.age;
      const option = draft.selectedOption;
      const subChoice = typeof payload.subChoice === "string" ? (payload.subChoice as SubCourseOption) : undefined;
      if (!age || !option || !subChoice) return;
      const resolution = this.courseRouter.resolveCourse(age, option as PrimaryCourseOption, subChoice);
      if (resolution.kind === "course") {
        await this.askChangeCourseConfirm(parentId, peerId, draft.changeBookingId!, resolution.courseCode);
      }
      return;
    }

    const accepted = this.resolveCourseConfirm(payload, text);
    if (accepted === null) {
      await this.messages.sendText(peerId, "Подтвердите новый курс кнопкой.");
      return;
    }

    if (!accepted) {
      await this.handleChangeCourseStart(parentId, peerId, draft.changeBookingId!);
      return;
    }

    await this.askChangeLesson(parentId, peerId, draft.changeBookingId!, draft.changeCourseCode!);
  }

  private async handleChangeLessonSelection(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>,
    text: string
  ) {
    const lessonId = this.resolveLessonId(payload, text, draft.availableLessons);
    if (!lessonId) {
      await this.resendLessonOptions(peerId, draft, "Выберите новую дату кнопкой с номером.");
      return;
    }

    const selected = draft.availableLessons?.find((lesson) => lesson.id === lessonId);
    if (!selected || !draft.changeBookingId) {
      await this.messages.sendText(peerId, "Не удалось найти выбранную дату.");
      return;
    }

    const data: {
      moyklassClassId: number;
      moyklassLessonId: number;
      lessonDate: Date;
      lessonBeginTime: string;
      botCourseId?: string;
      moyklassJoinId?: null;
      moyklassLessonRecordId?: null;
    } = {
      moyklassClassId: selected.classId,
      moyklassLessonId: selected.id,
      lessonDate: new Date(`${selected.date}T00:00:00.000Z`),
      lessonBeginTime: selected.beginTime,
      moyklassJoinId: null,
      moyklassLessonRecordId: null
    };

    if (draft.changeCourseCode) {
      const course = await this.db.botCourse.findUniqueOrThrow({ where: { code: draft.changeCourseCode } });
      data.botCourseId = course.id;
    }

    await this.booking.releaseExternalRecords(draft.changeBookingId);
    await this.db.trialBooking.update({
      where: { id: draft.changeBookingId },
      data
    });
    await this.booking.syncExternalRecordsForBooking(draft.changeBookingId).catch((error) => {
      console.error("Failed to sync changed booking with MoyKlass", error);
    });
    await this.setSession(parentId, "idle", {});
    await this.messages.sendText(
      peerId,
      "Готово, запись обновлена. Если занятие уже было оплачено, повторно платить не нужно."
    );
    await this.renderChildrenMenu(parentId, peerId);
  }

  private async askChangeCourseConfirm(
    parentId: string,
    peerId: number,
    bookingId: string,
    courseCode: BotCourseCode
  ) {
    const booking = await this.db.trialBooking.findFirstOrThrow({
      where: { id: bookingId, child: { parentId } },
      include: { branch: true }
    });
    const course = await this.db.botCourse.findUniqueOrThrow({ where: { code: courseCode } });
    await this.setSession(parentId, "change_course_confirm", {
      changeBookingId: bookingId,
      changeCourseCode: courseCode
    });
    await this.messages.sendText(peerId, `Рекомендуем курс ${course.title}!`);
    await this.messages.sendText(peerId, course.description);
    await this.messages.sendText(peerId, `Описание курса:\n${booking.branch.baseUrl}${course.defaultUrl}`);
    await this.messages.sendKeyboard(peerId, "Поменять запись на этот курс?", this.messages.buildCourseConfirmButtons());
  }

  private async askChangeLesson(parentId: string, peerId: number, bookingId: string, courseCode: BotCourseCode) {
    const booking = await this.db.trialBooking.findFirstOrThrow({
      where: { id: bookingId, child: { parentId } }
    });
    try {
      const list = await this.runInteractiveExternalRequest(peerId, () =>
        this.booking.getAvailableLessons(booking.branchId, courseCode)
      );
      await this.setSession(parentId, "change_lesson_select", {
        changeBookingId: bookingId,
        changeCourseCode: courseCode,
        availableLessons: list.lessons
      });
      if (list.lessons.length === 0) {
        await this.sendNoLessonsMessage(peerId);
        return;
      }
      await this.messages.sendKeyboard(peerId, list.lessonsText, this.messages.buildLessonButtons(list.lessons));
    } catch (error) {
      await this.handleInteractiveExternalFailure(peerId, error, () => this.sendRetryLessonsMessage(peerId));
    }
  }

  private async handleRetryLessons(parentId: string, peerId: number, state: string, draft: SessionDraft) {
    if (state === "change_lesson_select" && draft.changeBookingId && draft.changeCourseCode) {
      await this.askChangeLesson(parentId, peerId, draft.changeBookingId, draft.changeCourseCode);
      return;
    }

    const branchId = draft.currentChild?.branchId;
    const courseCode = draft.currentChild?.courseCode;
    if (state !== "awaiting_lesson" || !branchId || !courseCode) {
      await this.messages.sendText(peerId, "Эта проверка уже устарела. Продолжим с текущего шага.");
      return;
    }

    try {
      const list = await this.runInteractiveExternalRequest(peerId, () =>
        this.booking.getAvailableLessons(branchId, courseCode)
      );
      draft.availableLessons = list.lessons;
      await this.setSession(parentId, "awaiting_lesson", draft);

      if (list.lessons.length === 0) {
        await this.sendNoLessonsMessage(peerId);
        return;
      }

      await this.messages.sendKeyboard(peerId, list.lessonsText, this.messages.buildLessonButtons(list.lessons));
    } catch (error) {
      await this.handleInteractiveExternalFailure(peerId, error, () => this.sendRetryLessonsMessage(peerId));
    }
  }

  private async repeatPaymentChoice(parentId: string, peerId: number, draft: SessionDraft) {
    const orderId = draft.orderId;
    if (!orderId) {
      await this.setSession(parentId, "idle", {});
      await this.messages.sendText(peerId, "Не удалось найти заказ. Откройте меню детей, чтобы проверить запись.");
      await this.renderChildrenMenu(parentId, peerId);
      return;
    }

    const isYanino = typeof draft.paymentChoiceIsYanino === "boolean"
      ? draft.paymentChoiceIsYanino
      : (await this.getPaymentChoice(orderId)).isYanino;
    await this.messages.sendKeyboard(
      peerId,
      this.buildPaymentChoiceMessage(isYanino),
      this.messages.buildPaymentButtons(orderId)
    );
  }

  private async getPaymentChoice(orderId: string): Promise<{ isYanino: boolean }> {
    const order = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { booking: { include: { branch: true } } } } }
    });
    return { isYanino: order.items.every((item) => item.booking.branch.code === "YANINO") };
  }

  private async runInteractiveExternalRequest<T>(peerId: number, operation: () => Promise<T>): Promise<T> {
    return withExternalApiRetry(operation, {
      attempts: 3,
      onRetry: async () => {
        await this.messages.sendText(peerId, "нет соединения с сервером, повторяем запрос");
      }
    });
  }

  private async handleInteractiveExternalFailure(
    peerId: number,
    error: unknown,
    resendButtons: () => Promise<void>
  ) {
    if (isRetryableExternalError(error)) {
      await this.messages.sendText(peerId, "сейчас наблюдаются неполадки с соединением. Попробуйте продолжить позже");
      await resendButtons();
      return;
    }

    await this.messages.sendText(peerId, `Не получилось выполнить запрос: ${this.errorMessage(error)}`);
    await resendButtons();
  }

  private async sendRetryLessonsMessage(peerId: number) {
    await this.messages.sendKeyboard(
      peerId,
      "Попробуйте проверить доступные даты еще раз.",
      this.messages.buildRetryLessonsButtons()
    );
  }

  private async sendNoLessonsMessage(peerId: number) {
    await this.messages.sendKeyboard(
      peerId,
      "Сейчас нет доступных дат для занятий. Попробуйте позже или нажмите кнопку, чтобы проверить еще раз.",
      this.messages.buildRetryLessonsButtons()
    );
  }

  private async renderChildrenMenu(parentId: string, peerId: number) {
    const bookings = await this.db.trialBooking.findMany({
      where: { child: { parentId }, status: { not: "cancelled" } },
      include: {
        child: true,
        branch: true,
        botCourse: true,
        orderItem: { include: { order: { include: { payment: true } } } }
      },
      orderBy: { createdAt: "desc" }
    });

    if (bookings.length === 0) {
      await this.messages.sendText(peerId, "Пока детей в меню нет.");
      return;
    }

    for (const booking of bookings) {
      await this.messages.sendKeyboard(peerId, this.menu.renderTrialChild(booking), [
        { label: "Изменить", payload: { action: "change_booking", bookingId: booking.id }, color: "primary" },
        { label: "Отменить", payload: { action: "cancel_booking", bookingId: booking.id }, color: "negative" }
      ]);
    }
  }

  private async getSession(parentId: string) {
    return this.db.botSession.upsert({
      where: { parentId },
      update: {},
      create: { parentId, state: "idle", draft: {} }
    });
  }

  private async setSession(parentId: string, state: string, draft: SessionDraft) {
    await this.db.botSession.upsert({
      where: { parentId },
      update: { state, draft: draft as Prisma.InputJsonValue },
      create: { parentId, state, draft: draft as Prisma.InputJsonValue }
    });
  }

  private buildEditButtons(draft: SessionDraft, fields: string[]) {
    const labels: Record<string, string> = {
      parentName: "Изменить имя",
      phone: "Изменить телефон",
      childrenCount: "Изменить число детей",
      childName: "Изменить имя ребенка",
      childAge: "Изменить возраст",
      branch: "Изменить адрес"
    };

    const hasValue: Record<string, boolean> = {
      parentName: Boolean(draft.parentName),
      phone: Boolean(draft.phone),
      childrenCount: Boolean(draft.childrenCount),
      childName: Boolean(draft.currentChild?.name),
      childAge: Boolean(draft.currentChild?.age),
      branch: Boolean(draft.currentChild?.branchId)
    };

    return this.messages.buildEditButtons(
      fields
        .filter((field) => labels[field] && hasValue[field])
        .map((field) => ({ field, label: labels[field] }))
    );
  }

  private isEditFieldAllowed(state: string, field: string): boolean {
    const allowedStateByField: Record<string, string> = {
      parentName: "awaiting_phone",
      phone: "awaiting_children_count",
      childrenCount: "awaiting_child_name",
      childName: "awaiting_child_age",
      childAge: "awaiting_branch",
      branch: "awaiting_course"
    };

    return allowedStateByField[field] === state;
  }

  private resolvePrimaryOption(payload: Record<string, unknown>, text: string): PrimaryCourseOption | null {
    if (payload.action === "course_option" && typeof payload.option === "string") {
      return payload.option as PrimaryCourseOption;
    }

    const normalized = text.trim().toLowerCase();
    const map: Record<string, PrimaryCourseOption> = {
      "с чего начать": "start",
      робототехника: "robotics",
      математика: "math",
      дизайн: "design",
      "создание игр": "games",
      программирование: "programming"
    };
    return map[normalized] ?? null;
  }

  private resolveCourseConfirm(payload: Record<string, unknown>, text: string): boolean | null {
    if (payload.action === "course_confirm" && typeof payload.accepted === "boolean") return payload.accepted;
    const normalized = text.trim().toLowerCase();
    if (normalized === "да, записываем" || normalized === "да" || normalized === "записываем") return true;
    if (normalized.startsWith("нет")) return false;
    return null;
  }

  private resolveLessonId(
    payload: Record<string, unknown>,
    text: string,
    lessons?: Array<{ id: number }>
  ): number | null {
    if (payload.action === "lesson" && typeof payload.lessonId === "number") return payload.lessonId;
    const index = Number.parseInt(text, 10);
    if (!Number.isInteger(index) || index < 1) return null;
    return lessons?.[index - 1]?.id ?? null;
  }

  private isDuplicate(eventKey: string): boolean {
    const now = Date.now();
    for (const [key, expiresAt] of this.processedEvents.entries()) {
      if (expiresAt <= now) this.processedEvents.delete(key);
    }

    if (this.processedEvents.has(eventKey)) return true;
    this.processedEvents.set(eventKey, now + 10 * 60_000);
    return false;
  }

  private getEventKey(update: VkIncomingUpdate): string {
    const message = update.object?.message;
    if (update.event_id) return `event:${update.event_id}`;
    if (message?.id) return `message:${message.peer_id}:${message.id}`;
    if (message?.conversation_message_id) {
      return `conversation:${message.peer_id}:${message.conversation_message_id}`;
    }
    return `fallback:${message?.peer_id}:${message?.from_id}:${message?.date}:${message?.text}:${JSON.stringify(
      message?.payload ?? {}
    )}`;
  }

  private toDraft(value: Prisma.JsonValue): SessionDraft {
    return typeof value === "object" && value && !Array.isArray(value) ? (value as SessionDraft) : {};
  }

  private parsePayload(payload: unknown): Record<string, unknown> {
    if (!payload) return {};
    if (typeof payload === "object") return payload as Record<string, unknown>;
    if (typeof payload !== "string") return {};
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" && value ? value : null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "неизвестная ошибка";
  }
}
