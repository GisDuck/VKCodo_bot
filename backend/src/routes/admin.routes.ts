import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { BRANCHES, COURSE_CATALOG, DEFAULT_MANAGER_ID } from "../domain/catalog.js";
import { prisma } from "../lib/prisma.js";
import { MoyKlassService } from "../services/moyklass.service.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    if (!isAuthorized(request)) {
      reply.header("WWW-Authenticate", 'Basic realm="Codorobot admin"');
      return reply.code(401).send("Auth required");
    }
  });

  app.get("/admin", async (_request, reply) => {
    const [branches, mappings, settings] = await Promise.all([
      prisma.branch.findMany({ orderBy: { name: "asc" } }),
      prisma.courseMapping.findMany({ include: { botCourse: true }, orderBy: { botCourse: { title: "asc" } } }),
      prisma.appSetting.findMany()
    ]);

    return html(
      reply,
      "Codorobot admin",
      `
      <h1>Codorobot admin</h1>
      <nav>
        <a href="/admin/courses">Курсы</a>
        <a href="/admin/branches">Филиалы</a>
        <a href="/admin/settings">Настройки</a>
      </nav>
      <h2>Филиалы</h2>
      <ul>${branches.map((branch) => `<li>${escapeHtml(branch.name)}: ${branch.moyklassId}</li>`).join("")}</ul>
      <h2>Курсы</h2>
      <ul>${mappings
        .map((mapping) => `<li>${escapeHtml(mapping.botCourse.title)}: ${mapping.moyklassCourseId}</li>`)
        .join("")}</ul>
      <h2>Настройки</h2>
      <pre>${escapeHtml(JSON.stringify(settings, null, 2))}</pre>
      `
    );
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
      <h1>Сопоставление курсов</h1>
      <form method="post" action="/admin/moyklass/sync-courses">
        <button type="submit">Загрузить курсы из МойКласс</button>
      </form>
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
      <p><a href="/admin">Назад</a></p>
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
      <h1>Филиалы</h1>
      <form method="post" action="/admin/branches">
        ${branches
          .map(
            (branch) => `
            <fieldset>
              <legend>${escapeHtml(branch.name)}</legend>
              <input type="hidden" name="${branch.id}:id" value="${branch.id}" />
              <label>Название <input name="${branch.id}:name" value="${escapeHtml(branch.name)}" /></label>
              <label>Адрес <input name="${branch.id}:address" value="${escapeHtml(branch.address)}" /></label>
              <label>ID МойКласс <input name="${branch.id}:moyklassId" value="${branch.moyklassId}" /></label>
              <label>Base URL <input name="${branch.id}:baseUrl" value="${escapeHtml(branch.baseUrl)}" /></label>
            </fieldset>
          `
          )
          .join("")}
        <button type="submit">Сохранить</button>
      </form>
      <p><a href="/admin">Назад</a></p>
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

    return html(
      reply,
      "Настройки",
      `
      <h1>Настройки</h1>
      <form method="post" action="/admin/settings">
        <label>Manager ID <input name="managerId" value="${manager}" /></label>
        <label>Цена пробного, ₽ <input name="trialPriceRubles" value="${price}" /></label>
        <label>Реферальная цена, ₽ <input name="referralTrialPriceRubles" value="${referralPrice}" /></label>
        <label>Тестовая оплата <select name="paymentTestMode">
          <option value="true" ${testMode ? "selected" : ""}>Включена</option>
          <option value="false" ${!testMode ? "selected" : ""}>Выключена</option>
        </select></label>
        <button type="submit">Сохранить</button>
      </form>
      <p><a href="/admin">Назад</a></p>
      `
    );
  });

  app.post("/admin/settings", async (request, reply) => {
    const body = request.body as Record<string, string>;
    await setSetting("managerId", Number.parseInt(body.managerId ?? String(DEFAULT_MANAGER_ID), 10));
    await setSetting("trialPriceRubles", Number.parseInt(body.trialPriceRubles ?? "600", 10));
    await setSetting("referralTrialPriceRubles", Number.parseInt(body.referralTrialPriceRubles ?? "300", 10));
    await setSetting("paymentTestMode", body.paymentTestMode === "true");
    return reply.redirect("/admin/settings");
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
          body { font-family: system-ui, sans-serif; max-width: 960px; margin: 32px auto; padding: 0 16px; color: #17202a; }
          nav, form { display: grid; gap: 12px; margin: 20px 0; }
          label { display: grid; gap: 4px; margin: 10px 0; }
          input, select, button { font: inherit; padding: 9px 11px; }
          fieldset { border: 1px solid #d8dee8; border-radius: 8px; margin: 12px 0; }
          a { color: #0b63ce; }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
