import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { adminRoutes, ensureSeedData } from "./routes/admin.routes.js";
import { paymentsRoutes } from "./routes/payments.routes.js";
import { webhooksRoutes } from "./routes/webhooks.routes.js";
import { BookingService } from "./services/booking.service.js";
import { MoyKlassSyncQueueService } from "./services/moyklass-sync-queue.service.js";

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

  app.post("/jobs/expire-payments", async () => {
    const count = await new BookingService().expirePendingOrders();
    return { expired: count };
  });

  app.post("/jobs/process-moyklass-sync", async () => {
    const processed = await new MoyKlassSyncQueueService().processPending();
    return { processed };
  });

  app.addHook("onReady", async () => {
    await ensureSeedData();
  });

  return app;
}
