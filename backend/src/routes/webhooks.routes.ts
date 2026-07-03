import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { BookingService } from "../services/booking.service.js";
import { TBankService } from "../services/tbank.service.js";
import { VkBotService } from "../services/vk-bot.service.js";

export async function webhooksRoutes(app: FastifyInstance) {
  const vkBot = new VkBotService();
  const tbank = new TBankService();
  const booking = new BookingService();

  app.post("/webhooks/vk", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (body.type === "confirmation") {
      return reply.type("text/plain").send(env.VK_CONFIRMATION_CODE);
    }

    if (env.VK_SECRET && body.secret !== env.VK_SECRET) {
      return reply.code(403).send({ error: "invalid secret" });
    }

    await vkBot.handleUpdate(body);
    return { ok: true };
  });

  app.post("/webhooks/tbank", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!tbank.validateNotification(body)) {
      return reply.code(403).send({ error: "invalid token" });
    }

    const orderId = typeof body.OrderId === "string" ? body.OrderId : undefined;
    if (!orderId) return reply.code(400).send({ error: "OrderId is required" });

    const payment = await prisma.payment.findFirst({
      where: { OR: [{ tbankOrderId: orderId }, { orderId }] }
    });
    if (!payment) return reply.code(404).send({ error: "payment not found" });

    if (tbank.isPaidStatus(body.Status)) {
      await booking.handlePaidOrder(payment.orderId);
    } else {
      await prisma.payment.update({
        where: { orderId: payment.orderId },
        data: { status: "failed" }
      });
    }

    return "OK";
  });
}
