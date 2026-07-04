import { ChildStatus, Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { BRANCHES, COURSE_CATALOG, DEFAULT_MANAGER_ID } from "../domain/catalog.js";
import { prisma } from "../lib/prisma.js";
import { MoyKlassService } from "../services/moyklass.service.js";
import { TrialReminderService } from "../services/trial-reminder.service.js";

const childStatuses = [ChildStatus.trial, ChildStatus.active, ChildStatus.archived];
const childStatusLabels: Record<ChildStatus, string> = {
  trial: "Пробное",
  active: "Ходит на занятия",
  archived: "Архив"
};

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    if (!isAuthorized(request)) {
      reply.header("WWW-Authenticate", 'Basic realm="Codorobot admin"');
      return reply.code(401).send("Auth required");
    }
  });

  app.get("/admin", async (_request, reply) => {
    const [branches, mappings, settings, clientsCount] = await Promise.all([
      prisma.branch.findMany({ orderBy: { name: "asc" } }),
      prisma.courseMapping.findMany({ include: { botCourse: true }, orderBy: { botCourse: { title: "asc" } } }),
      prisma.appSetting.findMany(),
      prisma.parent.count()
    ]);

    return html(
      reply,
      "Codorobot admin",
      `
      ${adminHeader("Главная")}
      <section class="grid">
        ${metricCard("Клиенты", clientsCount)}
        ${metricCard("Филиалы", branches.length)}
        ${metricCard("Курсы", mappings.length)}
        ${metricCard("Настройки", settings.length)}
      </section>

      <section class="panel">
        <h2>Быстрый обзор</h2>
        <div class="columns">
          <div>
            <h3>Филиалы</h3>
            <ul>${branches.map((branch) => `<li>${escapeHtml(branch.name)}: ${branch.moyklassId}</li>`).join("")}</ul>
          </div>
          <div>
            <h3>Курсы</h3>
            <ul>${mappings
              .map((mapping) => `<li>${escapeHtml(mapping.botCourse.title)}: ${mapping.moyklassCourseId}</li>`)
              .join("")}</ul>
          </div>
        </div>
      </section>
      `
    );
  });

  app.get("/admin/clients", async (_request, reply) => {
    const clients = await prisma.parent.findMany({
      include: {
        _count: { select: { children: true, orders: true } },
        children: { orderBy: { createdAt: "asc" } }
      },
      orderBy: { updatedAt: "desc" },
      take: 200
    });

    return html(
      reply,
      "Клиенты",
      `
      ${adminHeader("Клиенты")}
      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Клиенты бота</h2>
            <p>Здесь можно посмотреть родителя, детей, отредактировать данные или полностью удалить клиента из локальной базы бота.</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Родитель</th>
                <th>Телефон</th>
                <th>VK</th>
                <th>Дети</th>
                <th>Заказы</th>
                <th>Обновлен</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${clients.map(renderClientRow).join("") || `<tr><td colspan="7" class="muted">Клиентов пока нет.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      `
    );
  });

  app.get<{ Params: { id: string } }>("/admin/clients/:id", async (request, reply) => {
    const client = await prisma.parent.findUnique({
      where: { id: request.params.id },
      include: {
        children: {
          include: {
            bookings: {
              include: { branch: true, botCourse: true },
              orderBy: { createdAt: "desc" }
            }
          },
          orderBy: { createdAt: "asc" }
        },
        orders: {
          include: { payment: true, items: true },
          orderBy: { createdAt: "desc" }
        },
        sessions: true
      }
    });

    if (!client) return reply.code(404).send("Client not found");

    return html(
      reply,
      `Клиент ${client.name ?? client.vkUserId.toString()}`,
      `
      ${adminHeader("Клиент")}
      <section class="panel">
        <div class="section-title">
          <div>
            <h2>${escapeHtml(client.name ?? "Без имени")}</h2>
            <p>VK ID: ${client.vkUserId.toString()} · создан ${formatDateTime(client.createdAt)}</p>
          </div>
          <form method="post" action="/admin/clients/${client.id}/delete" onsubmit="return confirm('Удалить клиента полностью из локальной базы бота?');">
            <button class="danger" type="submit">Удалить клиента</button>
          </form>
        </div>

        <form method="post" action="/admin/clients/${client.id}">
          <fieldset>
            <legend>Родитель</legend>
            <label>Имя родителя <input name="parent:name" value="${escapeHtml(client.name ?? "")}" /></label>
            <label>Телефон <input name="parent:phone" value="${escapeHtml(client.phone ?? "")}" /></label>
            <label>Реферальная метка <input name="parent:referralPayload" value="${escapeHtml(client.referralPayload ?? "")}" /></label>
            <label class="check"><input type="checkbox" name="parent:referralApplied" ${client.referralApplied ? "checked" : ""} /> Реферальная цена включена</label>
          </fieldset>

          <h3>Дети</h3>
          ${client.children.map(renderChildEditor).join("") || `<p class="muted">У клиента пока нет детей.</p>`}

          <button type="submit">Сохранить изменения</button>
        </form>
      </section>

      <section class="panel">
        <h2>Записи на пробные</h2>
        ${renderBookings(client.children)}
      </section>

      <section class="panel">
        <h2>Заказы</h2>
        ${renderOrders(client.orders)}
      </section>
      `
    );
  });

  app.post<{ Params: { id: string } }>("/admin/clients/:id", async (request, reply) => {
    const body = request.body as Record<string, string | string[] | undefined>;
    const client = await prisma.parent.findUnique({
      where: { id: request.params.id },
      include: { children: true }
    });

    if (!client) return reply.code(404).send("Client not found");

    await prisma.parent.update({
      where: { id: client.id },
      data: {
        name: emptyToNull(getSingle(body["parent:name"])),
        phone: emptyToNull(getSingle(body["parent:phone"])),
        referralPayload: emptyToNull(getSingle(body["parent:referralPayload"])),
        referralApplied: getSingle(body["parent:referralApplied"]) === "on"
      }
    });

    for (const child of client.children) {
      const name = getSingle(body[`child:${child.id}:name`]).trim();
      const ageRaw = getSingle(body[`child:${child.id}:age`]).trim();
      const moyklassRaw = getSingle(body[`child:${child.id}:moyklassUserId`]).trim();
      const statusRaw = getSingle(body[`child:${child.id}:status`]);
      const status = childStatuses.includes(statusRaw as ChildStatus) ? (statusRaw as ChildStatus) : child.status;

      await prisma.child.update({
        where: { id: child.id },
        data: {
          name: name || child.name,
          age: parseOptionalInt(ageRaw),
          moyklassUserId: parseOptionalInt(moyklassRaw),
          status
        }
      });
    }

    return reply.redirect(`/admin/clients/${client.id}`);
  });

  app.post<{ Params: { id: string } }>("/admin/clients/:id/delete", async (request, reply) => {
    const client = await prisma.parent.findUnique({
      where: { id: request.params.id },
      include: { children: true, orders: true }
    });

    if (!client) return reply.redirect("/admin/clients");

    const childIds = client.children.map((child) => child.id);
    const orderIds = client.orders.map((order) => order.id);

    await prisma.$transaction([
      prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }),
      prisma.orderItem.deleteMany({
        where: {
          OR: [{ orderId: { in: orderIds } }, { childId: { in: childIds } }]
        }
      }),
      prisma.order.deleteMany({ where: { parentId: client.id } }),
      prisma.trialBooking.deleteMany({ where: { childId: { in: childIds } } }),
      prisma.child.deleteMany({ where: { parentId: client.id } }),
      prisma.botSession.deleteMany({ where: { parentId: client.id } }),
      prisma.parent.delete({ where: { id: client.id } })
    ]);

    return reply.redirect("/admin/clients");
  });

  app.get("/admin/courses", async (_request, reply) => {
    const mappings = await prisma.courseMapping.findMany({
      include: { botCourse: true },
      orderBy: { botCourse: { title: "asc" } }
    });

    return html(
      reply,
      "Курсы",
      `
      ${adminHeader("Курсы")}
      <section class="panel">
        <div class="section-title">
          <div>
            <h2>Сопоставление курсов</h2>
            <p>Эти ID можно менять каждый учебный год без правки кода.</p>
          </div>
          <form method="post" action="/admin/moyklass/sync-courses">
            <button type="submit">Загрузить курсы из МойКласс</button>
          </form>
        </div>
        <form method="post" action="/admin/courses">
          ${mappings
            .map(
              (mapping) => `
              <label>
                ${escapeHtml(mapping.botCourse.title)}
                <input name="${mapping.id}" value="${mapping.moyklassCourseId}" inputmode="numeric" />
              </label>
            `
            )
            .join("")}
          <button type="submit">Сохранить</button>
        </form>
      </section>
      `
    );
  });

  app.post("/admin/courses", async (request, reply) => {
    const body = request.body as Record<string, string>;
    for (const [id, value] of Object.entries(body)) {
      const moyklassCourseId = Number.parseInt(value, 10);
      if (Number.isInteger(moyklassCourseId)) {
        await prisma.courseMapping.update({ where: { id }, data: { moyklassCourseId } });
      }
    }
    return reply.redirect("/admin/courses");
  });

  app.get("/admin/branches", async (_request, reply) => {
    const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
    return html(
      reply,
      "Филиалы",
      `
      ${adminHeader("Филиалы")}
      <section class="panel">
        <h2>Филиалы</h2>
        <form method="post" action="/admin/branches">
          ${branches
            .map(
              (branch) => `
              <fieldset>
                <legend>${escapeHtml(branch.name)}</legend>
                <input type="hidden" name="${branch.id}:id" value="${branch.id}" />
                <label>Название <input name="${branch.id}:name" value="${escapeHtml(branch.name)}" /></label>
                <label>Адрес <input name="${branch.id}:address" value="${escapeHtml(branch.address)}" /></label>
                <label>Ссылка на Яндекс Карты <input name="${branch.id}:mapUrl" value="${escapeHtml(branch.mapUrl ?? "")}" /></label>
                <label>ID МойКласс <input name="${branch.id}:moyklassId" value="${branch.moyklassId}" /></label>
                <label>Base URL <input name="${branch.id}:baseUrl" value="${escapeHtml(branch.baseUrl)}" /></label>
              </fieldset>
            `
            )
            .join("")}
          <button type="submit">Сохранить</button>
        </form>
      </section>
      `
    );
  });

  app.post("/admin/branches", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const ids = new Set(Object.keys(body).map((key) => key.split(":")[0]));
    for (const id of ids) {
      if (!body[`${id}:id`]) continue;
      await prisma.branch.update({
        where: { id },
        data: {
          name: body[`${id}:name`],
          address: body[`${id}:address`],
          mapUrl: emptyToNull(body[`${id}:mapUrl`] ?? ""),
          moyklassId: Number.parseInt(body[`${id}:moyklassId`], 10),
          baseUrl: body[`${id}:baseUrl`]
        }
      });
    }
    return reply.redirect("/admin/branches");
  });

  app.get("/admin/settings", async (_request, reply) => {
    const manager = await getSetting("managerId", DEFAULT_MANAGER_ID);
    const price = await getSetting("trialPriceRubles", 600);
    const referralPrice = await getSetting("referralTrialPriceRubles", 300);
    const testMode = await getSetting("paymentTestMode", env.PAYMENT_TEST_MODE);
    const developerMode = await getSetting("developerMode", false);
    const developerTodayDate = await getSetting("developerTodayDate", todayInputValue());

    return html(
      reply,
      "Настройки",
      `
      ${adminHeader("Настройки")}
      <section class="panel">
        <h2>Настройки бота</h2>
        <form method="post" action="/admin/settings">
          <label>Manager ID <input name="managerId" value="${manager}" /></label>
          <label>Цена пробного, ₽ <input name="trialPriceRubles" value="${price}" /></label>
          <label>Реферальная цена, ₽ <input name="referralTrialPriceRubles" value="${referralPrice}" /></label>
          <label>Тестовая оплата <select name="paymentTestMode">
            <option value="true" ${testMode ? "selected" : ""}>Включена</option>
            <option value="false" ${!testMode ? "selected" : ""}>Выключена</option>
          </select></label>
          <label>Режим разработчика <select name="developerMode">
            <option value="false" ${!developerMode ? "selected" : ""}>Выключен</option>
            <option value="true" ${developerMode ? "selected" : ""}>Включен</option>
          </select></label>
          <label>Сегодня в режиме разработчика <input type="date" name="developerTodayDate" value="${escapeHtml(developerTodayDate)}" /></label>
          <p class="muted">Эта дата используется только когда включен режим разработчика. В обычном режиме бот ищет занятия и напоминания от реальной сегодняшней даты.</p>
          <button type="submit">Сохранить</button>
        </form>
        <form method="post" action="/admin/reminders/send-trial" style="margin-top:16px">
          <button type="submit">Отправить напоминания на завтра</button>
        </form>
      </section>
      `
    );
  });

  app.post("/admin/settings", async (request, reply) => {
    const body = request.body as Record<string, string>;
    await setSetting("managerId", Number.parseInt(body.managerId ?? String(DEFAULT_MANAGER_ID), 10));
    await setSetting("trialPriceRubles", Number.parseInt(body.trialPriceRubles ?? "600", 10));
    await setSetting("referralTrialPriceRubles", Number.parseInt(body.referralTrialPriceRubles ?? "300", 10));
    await setSetting("paymentTestMode", body.paymentTestMode === "true");
    await setSetting("developerMode", body.developerMode === "true");
    await setSetting("developerTodayDate", validDateInput(body.developerTodayDate) ? body.developerTodayDate : todayInputValue());
    return reply.redirect("/admin/settings");
  });

  app.post("/admin/reminders/send-trial", async (_request, reply) => {
    const result = await new TrialReminderService().sendTomorrowTrialReminders();
    return html(
      reply,
      "Напоминания",
      `
      ${adminHeader("Настройки")}
      <section class="panel">
        <h2>Напоминания отправлены</h2>
        <p>Дата проверки: ${escapeHtml(result.checkedDate)}</p>
        <p>Ищем пробные на: ${escapeHtml(result.targetDate)}</p>
        <p>Найдено: ${result.found}</p>
        <p>Отправлено: ${result.sent}</p>
        <p><a href="/admin/settings">Вернуться в настройки</a></p>
      </section>
      `
    );
  });

  app.post("/admin/moyklass/sync-courses", async (_request, reply) => {
    const service = new MoyKlassService();
    const courses = await service.getCourses();
    await setSetting("lastMoyKlassCourses", courses);
    return reply.redirect("/admin/courses");
  });
}

export async function ensureSeedData() {
  for (const branch of BRANCHES) {
    await prisma.branch.upsert({
      where: { code: branch.code },
      update: branch,
      create: branch
    });
  }

  for (const course of COURSE_CATALOG) {
    const savedCourse = await prisma.botCourse.upsert({
      where: { code: course.code },
      update: {
        title: course.title,
        slug: course.slug,
        description: course.description,
        defaultUrl: course.defaultUrl
      },
      create: {
        code: course.code,
        title: course.title,
        slug: course.slug,
        description: course.description,
        defaultUrl: course.defaultUrl
      }
    });
    await prisma.courseMapping.upsert({
      where: { botCourseId: savedCourse.id },
      update: {},
      create: {
        botCourseId: savedCourse.id,
        moyklassCourseId: course.defaultMoyklassCourseId
      }
    });
  }
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return setting ? (setting.value as T) : fallback;
}

async function setSetting(key: string, value: unknown) {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue }
  });
}

function adminHeader(active: string): string {
  const links = [
    ["Главная", "/admin"],
    ["Клиенты", "/admin/clients"],
    ["Курсы", "/admin/courses"],
    ["Филиалы", "/admin/branches"],
    ["Настройки", "/admin/settings"]
  ];

  return `
    <header>
      <div>
        <p class="eyebrow">Codorobot</p>
        <h1>${escapeHtml(active)}</h1>
      </div>
      <nav>
        ${links
          .map(([title, href]) => `<a class="${title === active ? "active" : ""}" href="${href}">${title}</a>`)
          .join("")}
      </nav>
    </header>
  `;
}

function renderClientRow(client: {
  id: string;
  vkUserId: bigint;
  name: string | null;
  phone: string | null;
  updatedAt: Date;
  children: { name: string; age: number | null; status: ChildStatus }[];
  _count: { children: number; orders: number };
}): string {
  const children = client.children
    .map((child) => `${escapeHtml(child.name)}${child.age ? `, ${child.age}` : ""}`)
    .join("<br />");

  return `
    <tr>
      <td><strong>${escapeHtml(client.name ?? "Без имени")}</strong><div class="muted">${children || "Нет детей"}</div></td>
      <td>${escapeHtml(client.phone ?? "—")}</td>
      <td>${client.vkUserId.toString()}</td>
      <td>${client._count.children}</td>
      <td>${client._count.orders}</td>
      <td>${formatDateTime(client.updatedAt)}</td>
      <td><a class="button-link" href="/admin/clients/${client.id}">Открыть</a></td>
    </tr>
  `;
}

function renderChildEditor(child: {
  id: string;
  name: string;
  age: number | null;
  status: ChildStatus;
  moyklassUserId: number | null;
}): string {
  return `
    <fieldset>
      <legend>${escapeHtml(child.name)}</legend>
      <label>Имя ребенка <input name="child:${child.id}:name" value="${escapeHtml(child.name)}" /></label>
      <label>Возраст <input name="child:${child.id}:age" value="${child.age ?? ""}" inputmode="numeric" /></label>
      <label>ID клиента в МойКласс <input name="child:${child.id}:moyklassUserId" value="${child.moyklassUserId ?? ""}" inputmode="numeric" /></label>
      <label>Статус
        <select name="child:${child.id}:status">
          ${childStatuses
            .map(
              (status) =>
                `<option value="${status}" ${child.status === status ? "selected" : ""}>${childStatusLabels[status]}</option>`
            )
            .join("")}
        </select>
      </label>
    </fieldset>
  `;
}

function renderBookings(
  children: {
    name: string;
    bookings: {
      id: string;
      status: string;
      lessonDate: Date | null;
      lessonBeginTime: string | null;
      moyklassClassId: number | null;
      moyklassLessonId: number | null;
      branch: { name: string };
      botCourse: { title: string };
    }[];
  }[]
): string {
  const rows = children.flatMap((child) =>
    child.bookings.map(
      (booking) => `
        <tr>
          <td>${escapeHtml(child.name)}</td>
          <td>${escapeHtml(booking.branch.name)}</td>
          <td>${escapeHtml(booking.botCourse.title)}</td>
          <td>${booking.lessonDate ? formatDate(booking.lessonDate) : "—"} ${escapeHtml(booking.lessonBeginTime ?? "")}</td>
          <td>${escapeHtml(booking.status)}</td>
          <td>${booking.moyklassClassId ?? "—"} / ${booking.moyklassLessonId ?? "—"}</td>
        </tr>
      `
    )
  );

  if (rows.length === 0) return `<p class="muted">Записей пока нет.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Ребенок</th><th>Филиал</th><th>Курс</th><th>Дата</th><th>Статус</th><th>Класс / занятие</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

function renderOrders(
  orders: {
    id: string;
    status: string;
    totalKopecks: number;
    createdAt: Date;
    payment: { method: string; status: string; chargedKopecks: number } | null;
    items: { title: string; amountKopecks: number }[];
  }[]
): string {
  if (orders.length === 0) return `<p class="muted">Заказов пока нет.</p>`;

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Дата</th><th>Статус</th><th>Сумма</th><th>Оплата</th><th>Позиции</th></tr></thead>
        <tbody>
          ${orders
            .map(
              (order) => `
              <tr>
                <td>${formatDateTime(order.createdAt)}</td>
                <td>${escapeHtml(order.status)}</td>
                <td>${formatMoney(order.totalKopecks)}</td>
                <td>${order.payment ? `${escapeHtml(order.payment.method)} · ${escapeHtml(order.payment.status)} · ${formatMoney(order.payment.chargedKopecks)}` : "—"}</td>
                <td>${order.items.map((item) => `${escapeHtml(item.title)}: ${formatMoney(item.amountKopecks)}`).join("<br />")}</td>
              </tr>
            `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function metricCard(title: string, value: number): string {
  return `<article class="metric"><span>${escapeHtml(title)}</span><strong>${value}</strong></article>`;
}

function isAuthorized(request: FastifyRequest): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const [username, password] = decoded.split(":");
  return username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD;
}

function html(reply: FastifyReply, title: string, body: string) {
  return reply.type("text/html; charset=utf-8").send(`
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>
          :root { color-scheme: light; --bg: #f6f3ee; --panel: #fffdf9; --text: #1d242d; --muted: #69717c; --line: #e3ddd2; --brand: #185c8f; --brand-soft: #e5f1f8; --danger: #b42318; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
          body::before { content: ""; position: fixed; inset: 0 0 auto; height: 220px; background: linear-gradient(135deg, #d8ecf8, #f7dfc4); z-index: -1; }
          main { width: min(1180px, calc(100vw - 32px)); margin: 28px auto 48px; }
          header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 24px; }
          h1, h2, h3, p { margin-top: 0; }
          h1 { margin-bottom: 0; font-size: clamp(30px, 5vw, 48px); }
          h2 { margin-bottom: 14px; font-size: 24px; }
          h3 { margin-bottom: 10px; font-size: 17px; }
          .eyebrow { margin-bottom: 6px; color: var(--brand); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
          nav { display: flex; flex-wrap: wrap; gap: 8px; }
          nav a, .button-link, button { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; background: var(--panel); color: var(--text); text-decoration: none; font: inherit; cursor: pointer; }
          nav a.active, .button-link, button[type="submit"] { background: var(--brand); border-color: var(--brand); color: white; }
          button.danger { background: var(--danger); border-color: var(--danger); color: white; }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
          .metric, .panel { background: rgba(255, 253, 249, .92); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 14px 45px rgba(48, 42, 34, .08); }
          .metric { padding: 18px; }
          .metric span, .muted { color: var(--muted); }
          .metric strong { display: block; margin-top: 8px; font-size: 34px; }
          .panel { padding: 22px; margin: 18px 0; }
          .columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
          .section-title { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
          form { display: grid; gap: 14px; }
          label { display: grid; gap: 6px; font-weight: 650; }
          label.check { display: flex; align-items: center; gap: 8px; }
          input, select { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: white; color: var(--text); font: inherit; padding: 10px 12px; }
          input[type="checkbox"] { width: auto; }
          fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 0; display: grid; gap: 12px; }
          legend { padding: 0 8px; font-weight: 800; }
          .table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
          table { width: 100%; border-collapse: collapse; background: white; }
          th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-size: 13px; color: var(--muted); }
          tr:last-child td { border-bottom: 0; }
          ul { padding-left: 20px; margin-bottom: 0; }
          @media (max-width: 760px) {
            main { width: min(100vw - 20px, 1180px); margin-top: 16px; }
            header, .section-title { display: grid; }
            .grid, .columns { grid-template-columns: 1fr; }
            nav a { flex: 1 1 auto; text-align: center; }
          }
        </style>
      </head>
      <body><main>${body}</main></body>
    </html>
  `);
}

function getSingle(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalInt(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(value);
}

function formatMoney(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(kopecks / 100);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function validDateInput(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
