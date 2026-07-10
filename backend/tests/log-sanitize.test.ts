import { describe, expect, it } from "vitest";
import { sanitizeLogPayload } from "../src/lib/log-sanitize.js";

describe("log sanitization", () => {
  it("redacts message text, payloads, phones, and secrets", () => {
    expect(
      sanitizeLogPayload({
        peerId: 1,
        text: "hello",
        phone: "+79999999999",
        payload: { action: "pay" },
        nested: {
          accessToken: "token",
          childName: "name"
        }
      })
    ).toEqual({
      peerId: 1,
      text: "[redacted]",
      phone: "[redacted]",
      payload: "[redacted]",
      nested: {
        accessToken: "[redacted]",
        childName: "[redacted]"
      }
    });
  });
});
