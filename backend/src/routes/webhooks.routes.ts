import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { BookingService } from "../services/booking.service.js";
import { TBankService } from "../services/tbank.service.js";
import { VkEventLogService } from "../services/vk-event-log.service.js";
import { VkBotService } from "../services/vk-bot.service.js";

export async function webhooksRoutes(app: FastifyInstance) {
  const vkBot = new VkBotService();
  const tbank = new TBankService();
  const booking = new BookingService();
  const vkLog = new VkEventLogService();

  app.post("/webhooks/vk", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const receivedAt = new Date().toISOString();

    if (body.type === "confirmation") {
      await vkLog.write("confirmation", { receivedAt });
      return reply.type("text/plain").send(env.VK_CONFIRMATION_CODE);
    }

    if (env.VK_SECRET && body.secret !== env.VK_SECRET) {
      await vkLog.write("invalid_secret", { receivedAt, type: body.type });
      return reply.code(403).send({ error: "invalid secret" });
    }

    await vkLog.write("callback_received", {
      receivedAt,
      type: body.type,
      eventId: body.event_id,
      groupId: body.group_id,
      message: summarizeVkMessage(body)
    });

    void vkBot.handleUpdate(body).catch((error) => {
      request.log.error({ error }, "VK background handling failed");
    });

    return reply.type("text/plain").send("ok");
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

function summarizeVkMessage(body: Record<string, unknown>) {
  const object = body.object as { message?: Record<string, unknown> } | undefined;
  const message = object?.message;
  if (!message) return undefined;

  return {
    id: message.id,
    conversationMessageId: message.conversation_message_id,
    fromId: message.from_id,
    peerId: message.peer_id,
    date: message.date,
    text: message.text,
    payload: message.payload,
    ref: message.ref
  };
}
