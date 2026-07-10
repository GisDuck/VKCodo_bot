import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { adminRoutes, ensureSeedData } from "./routes/admin.routes.js";
import { paymentsRoutes } from "./routes/payments.routes.js";
import { webhooksRoutes } from "./routes/webhooks.routes.js";
import { BookingService } from "./services/booking.service.js";
import { isAuthorizedJobRequest } from "./lib/job-auth.js";
import { prisma } from "./lib/prisma.js";
import { MoyKlassSyncQueueService } from "./services/moyklass-sync-queue.service.js";
import { TrialReminderService } from "./services/trial-reminder.service.js";
import { VkInboundEventService } from "./services/vk-inbound-event.service.js";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(formbody);
  await app.register(webhooksRoutes);
  await app.register(paymentsRoutes);
  await app.register(adminRoutes);

  app.get("/", async (_request, reply) => {
    return reply.redirect("/admin");
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/ready", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/jobs/")) return;
    if (!isAuthorizedJobRequest(request)) {
      return reply.code(403).send({ error: "invalid job token" });
    }
  });

  app.post("/jobs/expire-payments", async () => {
    const count = await new BookingService().expirePendingOrders();
    return { expired: count };
  });

  app.post("/jobs/process-moyklass-sync", async () => {
    const processed = await new MoyKlassSyncQueueService().processPending();
    return { processed };
  });

  app.post("/jobs/send-trial-reminders", async () => {
    return new TrialReminderService().sendTomorrowTrialReminders();
  });

  app.post("/jobs/process-vk-events", async () => {
    const processed = await new VkInboundEventService().processPending();
    return { processed };
  });

  app.addHook("onReady", async () => {
    await ensureSeedData();
  });

  return app;
}
