import { beforeEach, describe, expect, it, vi } from "vitest";

describe("VK inbound event keys", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  });

  it("uses VK event_id when present", async () => {
    const { buildVkEventKey } = await import("../src/services/vk-inbound-event.service.js");

    expect(buildVkEventKey({ event_id: "abc", type: "message_new" })).toBe("event:abc");
  });

  it("falls back to peer and conversation message id", async () => {
    const { buildVkEventKey } = await import("../src/services/vk-inbound-event.service.js");

    expect(
      buildVkEventKey({
        type: "message_new",
        object: { message: { peer_id: 123, conversation_message_id: 456 } }
      })
    ).toBe("message:123:456");
  });
});
