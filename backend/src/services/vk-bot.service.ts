import { BotCourseCode, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { CourseRouterService } from "./course-router.service.js";
import { BookingService } from "./booking.service.js";
import { MenuService } from "./menu.service.js";
import { VkMessageService } from "./vk-message.service.js";

type VkIncomingUpdate = {
  type?: string;
  object?: {
    message?: {
      from_id: number;
      peer_id: number;
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

  constructor(private readonly db: PrismaClient = prisma) {}

  async handleUpdate(update: VkIncomingUpdate): Promise<void> {
    if (update.type !== "message_new") return;

    const message = update.object?.message;
    if (!message?.from_id || !message.peer_id) return;

    const payload = this.parsePayload(message.payload);
    const text = (message.text ?? "").trim();
    const parent = await this.booking.upsertParent({
      vkUserId: message.from_id,
      referralPayload: message.ref ?? this.readString(payload.ref)
    });
    const session = await this.getSession(parent.id);
    const draft = this.toDraft(session.draft);

    if (payload.action === "start_trial" || /^начать|старт|запис/i.test(text)) {
      await this.setSession(parent.id, "awaiting_parent_name", {});
      await this.messages.sendText(message.peer_id, "Как вас зовут?");
      return;
    }

    if (payload.action === "children") {
      await this.renderChildrenMenu(parent.id, message.peer_id);
      return;
    }

    if (payload.action === "pay_online" && typeof payload.orderId === "string") {
      await this.handleOnlinePayment(message.peer_id, payload.orderId);
      return;
    }

    if (payload.action === "pay_on_site" && typeof payload.orderId === "string") {
      await this.handlePayOnSite(message.peer_id, payload.orderId);
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

    switch (session.state) {
      case "idle":
        await this.messages.sendMainMenu(message.peer_id);
        return;
      case "awaiting_parent_name":
        await this.handleParentName(parent.id, message.peer_id, draft, text);
        return;
      case "awaiting_phone":
        await this.handlePhone(parent.id, message.peer_id, draft, text);
        return;
      case "awaiting_children_count":
        await this.handleChildrenCount(parent.id, message.peer_id, draft, text);
        return;
      case "awaiting_child_name":
        await this.handleChildName(parent.id, message.peer_id, draft, text);
        return;
      case "awaiting_child_age":
        await this.handleChildAge(parent.id, message.peer_id, draft, text);
        return;
      case "awaiting_branch":
        await this.handleBranch(parent.id, message.peer_id, draft, payload);
        return;
      case "awaiting_course":
        await this.handleCourse(parent.id, message.peer_id, draft, payload);
        return;
      case "awaiting_course_confirm":
        await this.handleCourseConfirm(parent.id, message.peer_id, draft, payload);
        return;
      case "awaiting_lesson":
        await this.handleLesson(parent.id, message.peer_id, draft, payload);
        return;
      case "change_course_select":
        await this.handleChangeCourseSelection(parent.id, message.peer_id, draft, payload);
        return;
      case "change_course_confirm":
        await this.handleChangeCourseConfirm(parent.id, message.peer_id, draft, payload);
        return;
      case "change_lesson_select":
        await this.handleChangeLessonSelection(parent.id, message.peer_id, draft, payload);
        return;
      case "order_ready":
        await this.messages.sendText(message.peer_id, "Заказ уже собран. Выберите оплату онлайн или в филиале.");
        return;
      default:
        await this.setSession(parent.id, "idle", {});
        await this.messages.sendMainMenu(message.peer_id);
    }
  }

  private async handleParentName(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    if (!text) {
      await this.messages.sendText(peerId, "Напишите, пожалуйста, имя родителя.");
      return;
    }
    draft.parentName = text;
    await this.db.parent.update({ where: { id: parentId }, data: { name: text } });
    await this.setSession(parentId, "awaiting_phone", draft);
    await this.messages.sendText(peerId, "Укажите номер телефона для записи.");
  }

  private async handlePhone(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    if (text.replace(/\D/g, "").length < 10) {
      await this.messages.sendText(peerId, "Похоже, в телефоне не хватает цифр. Напишите номер еще раз.");
      return;
    }
    draft.phone = text;
    await this.db.parent.update({ where: { id: parentId }, data: { phone: text } });
    await this.setSession(parentId, "awaiting_children_count", draft);
    await this.messages.sendText(peerId, "Сколько детей хотите записать на пробное?");
  }

  private async handleChildrenCount(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    const count = Number.parseInt(text, 10);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      await this.messages.sendText(peerId, "Напишите число детей от 1 до 10.");
      return;
    }
    draft.childrenCount = count;
    draft.currentIndex = 0;
    draft.bookingIds = [];
    draft.currentChild = {};
    await this.setSession(parentId, "awaiting_child_name", draft);
    await this.messages.sendText(peerId, "Как зовут первого ребенка?");
  }

  private async handleChildName(parentId: string, peerId: number, draft: SessionDraft, text: string) {
    if (!text) {
      await this.messages.sendText(peerId, "Напишите имя ребенка.");
      return;
    }
    draft.currentChild = { name: text };
    await this.setSession(parentId, "awaiting_child_age", draft);
    await this.messages.sendText(peerId, `Сколько лет ребенку ${text}?`);
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
    await this.messages.sendBranchOptions(peerId, branches);
  }

  private async handleBranch(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>
  ) {
    if (payload.action !== "branch" || typeof payload.branchId !== "string") {
      await this.messages.sendText(peerId, "Выберите филиал кнопкой.");
      return;
    }

    draft.currentChild = { ...(draft.currentChild ?? {}), branchId: payload.branchId };
    await this.setSession(parentId, "awaiting_course", draft);
    const age = draft.currentChild.age;
    if (!age) return;
    await this.messages.sendCourseOptions(peerId, age, this.courseRouter.getAvailableOptions(age));
  }

  private async handleCourse(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>
  ) {
    const age = draft.currentChild?.age;
    if (!age || payload.action !== "course_option" || typeof payload.option !== "string") {
      await this.messages.sendText(peerId, "Выберите курс кнопкой.");
      return;
    }

    const option = payload.option as Parameters<CourseRouterService["resolveCourse"]>[1];
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
    payload: Record<string, unknown>
  ) {
    if (payload.action === "course_subchoice") {
      const age = draft.currentChild?.age;
      const option = draft.selectedOption;
      if (!age || !option || typeof payload.subChoice !== "string") return;
      const resolution = this.courseRouter.resolveCourse(
        age,
        option as Parameters<CourseRouterService["resolveCourse"]>[1],
        payload.subChoice as Parameters<CourseRouterService["resolveCourse"]>[2]
      );
      if (resolution.kind === "course") {
        await this.setCourseAndAskConfirm(parentId, peerId, draft, resolution.courseCode);
      }
      return;
    }

    if (payload.action !== "course_confirm") {
      await this.messages.sendText(peerId, "Подтвердите курс кнопкой.");
      return;
    }

    if (payload.accepted === false) {
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
      const list = await this.booking.getAvailableLessons(branchId, courseCode);
      draft.availableLessons = list.lessons;
      await this.setSession(parentId, "awaiting_lesson", draft);
      await this.messages.sendKeyboard(
        peerId,
        list.lessonsText,
        this.messages.buildLessonButtons(list.lessons)
      );
    } catch (error) {
      await this.messages.sendText(peerId, `Не получилось получить даты занятий: ${this.errorMessage(error)}`);
    }
  }

  private async handleLesson(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>
  ) {
    if (payload.action !== "lesson" || typeof payload.lessonId !== "number") {
      await this.messages.sendText(peerId, "Выберите дату кнопкой с номером.");
      return;
    }

    const selected = draft.availableLessons?.find((lesson) => lesson.id === payload.lessonId);
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

    await this.setSession(parentId, "order_ready", { bookingIds: draft.bookingIds });
    await this.messages.sendKeyboard(peerId, summary, this.messages.buildPaymentButtons(order.id));
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
    await this.messages.sendText(peerId, `Полное описание программы и модулей вы сможете найти по ссылке ниже:\n${branch.baseUrl}${course.defaultUrl}`);
    await this.messages.sendKeyboard(
      peerId,
      "Устраивает ли вас курс?",
      this.messages.buildCourseConfirmButtons()
    );
  }

  private async handleOnlinePayment(peerId: number, orderId: string) {
    try {
      const payment = await this.booking.initOnlinePayment(orderId);
      await this.messages.sendKeyboard(peerId, `Ссылка на оплату:\n${payment?.paymentUrl ?? ""}`, [
        { label: "Оплатить в филиале", payload: { action: "pay_on_site", orderId }, color: "secondary" }
      ]);
    } catch (error) {
      await this.messages.sendText(peerId, `Не удалось создать ссылку оплаты: ${this.errorMessage(error)}`);
    }
  }

  private async handlePayOnSite(peerId: number, orderId: string) {
    try {
      await this.booking.markPayOnSite(orderId);
      await this.messages.sendText(peerId, "Готово, записали. Оплатить можно будет в филиале.");
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
    payload: Record<string, unknown>
  ) {
    const booking = await this.db.trialBooking.findFirstOrThrow({
      where: { id: draft.changeBookingId, child: { parentId } },
      include: { child: true }
    });
    const age = booking.child.age;
    if (payload.action === "course_subchoice") {
      const option = draft.selectedOption;
      if (!age || !option || typeof payload.subChoice !== "string") return;
      const resolution = this.courseRouter.resolveCourse(
        age,
        option as Parameters<CourseRouterService["resolveCourse"]>[1],
        payload.subChoice as Parameters<CourseRouterService["resolveCourse"]>[2]
      );
      if (resolution.kind === "course") {
        await this.askChangeCourseConfirm(parentId, peerId, draft.changeBookingId!, resolution.courseCode);
      }
      return;
    }

    if (!age || payload.action !== "course_option" || typeof payload.option !== "string") {
      await this.messages.sendText(peerId, "Выберите новый курс кнопкой.");
      return;
    }

    const option = payload.option as Parameters<CourseRouterService["resolveCourse"]>[1];
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
    payload: Record<string, unknown>
  ) {
    if (payload.action === "course_subchoice") {
      const booking = await this.db.trialBooking.findFirstOrThrow({
        where: { id: draft.changeBookingId, child: { parentId } },
        include: { child: true }
      });
      const age = booking.child.age;
      const option = draft.selectedOption;
      if (!age || !option || typeof payload.subChoice !== "string") return;
      const resolution = this.courseRouter.resolveCourse(
        age,
        option as Parameters<CourseRouterService["resolveCourse"]>[1],
        payload.subChoice as Parameters<CourseRouterService["resolveCourse"]>[2]
      );
      if (resolution.kind === "course") {
        await this.askChangeCourseConfirm(parentId, peerId, draft.changeBookingId!, resolution.courseCode);
      }
      return;
    }

    if (payload.action !== "course_confirm") {
      await this.messages.sendText(peerId, "Подтвердите новый курс кнопкой.");
      return;
    }

    if (payload.accepted === false) {
      await this.handleChangeCourseStart(parentId, peerId, draft.changeBookingId!);
      return;
    }

    await this.askChangeLesson(parentId, peerId, draft.changeBookingId!, draft.changeCourseCode!);
  }

  private async handleChangeLessonSelection(
    parentId: string,
    peerId: number,
    draft: SessionDraft,
    payload: Record<string, unknown>
  ) {
    if (payload.action !== "lesson" || typeof payload.lessonId !== "number") {
      await this.messages.sendText(peerId, "Выберите новую дату кнопкой с номером.");
      return;
    }

    const selected = draft.availableLessons?.find((lesson) => lesson.id === payload.lessonId);
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
    await this.messages.sendText(peerId, "Готово, запись обновлена. Если занятие уже было оплачено, повторно платить не нужно.");
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
      const list = await this.booking.getAvailableLessons(booking.branchId, courseCode);
      await this.setSession(parentId, "change_lesson_select", {
        changeBookingId: bookingId,
        changeCourseCode: courseCode,
        availableLessons: list.lessons
      });
      await this.messages.sendKeyboard(peerId, list.lessonsText, this.messages.buildLessonButtons(list.lessons));
    } catch (error) {
      await this.messages.sendText(peerId, `Не получилось получить новые даты: ${this.errorMessage(error)}`);
    }
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
