import { Prisma, PrismaClient } from "@prisma/client";
import { errorMessage } from "../lib/external-retry.js";
import { prisma } from "../lib/prisma.js";
import { VkBotService } from "./vk-bot.service.js";

const RETRY_DELAY_MS = 60_000;

export class VkInboundEventService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly vkBot = new VkBotService()
  ) {}

  async enqueue(payload: Record<string, unknown>) {
    const eventKey = buildVkEventKey(payload);
    const eventType = typeof payload.type === "string" ? payload.type : "unknown";
    const vkEventId = typeof payload.event_id === "string" ? payload.event_id : null;

    return this.db.vkInboundEvent.upsert({
      where: { eventKey },
      update: { updatedAt: new Date() },
      create: {
        eventKey,
        vkEventId,
        type: eventType,
        payload: payload as Prisma.InputJsonValue
      }
    });
  }

  async processPending(limit = 20) {
    const events = await this.db.vkInboundEvent.findMany({
      where: {
        status: { in: ["received", "failed"] },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
      },
      orderBy: { receivedAt: "asc" },
      take: limit
    });

    let processed = 0;
    for (const event of events) {
      if (await this.processEvent(event.id)) processed += 1;
    }

    return processed;
  }

  async processEvent(eventId: string): Promise<boolean> {
    const claimed = await this.db.vkInboundEvent.updateMany({
      where: {
        id: eventId,
        status: { in: ["received", "failed"] },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }]
      },
      data: {
        status: "processing",
        lastError: null,
        nextRunAt: null
      }
    });

    if (claimed.count !== 1) return false;

    const event = await this.db.vkInboundEvent.findUniqueOrThrow({ where: { id: eventId } });

    try {
      await this.vkBot.handleUpdate(event.payload as Parameters<VkBotService["handleUpdate"]>[0]);
      await this.db.vkInboundEvent.update({
        where: { id: eventId },
        data: {
          status: "done",
          lastError: null,
          processedAt: new Date()
        }
      });
      return true;
    } catch (error) {
      await this.db.vkInboundEvent.update({
        where: { id: eventId },
        data: {
          status: "failed",
          attempts: { increment: 1 },
          lastError: errorMessage(error),
          nextRunAt: new Date(Date.now() + RETRY_DELAY_MS)
        }
      });
      throw error;
    }
  }
}

export function buildVkEventKey(payload: Record<string, unknown>): string {
  if (typeof payload.event_id === "string" && payload.event_id) return `event:${payload.event_id}`;

  const object = payload.object as { message?: Record<string, unknown> } | undefined;
  const message = object?.message;
  const peerId = message?.peer_id;
  const conversationMessageId = message?.conversation_message_id;
  const date = message?.date;
  if (peerId && conversationMessageId) return `message:${peerId}:${conversationMessageId}`;
  if (peerId && date) return `message-date:${peerId}:${date}`;

  return `raw:${JSON.stringify(payload)}`;
}
