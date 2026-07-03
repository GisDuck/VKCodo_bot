import { describe, expect, it } from "vitest";
import { BRANCHES } from "../src/domain/catalog.js";

describe("branch base urls", () => {
  it("uses codorobot.ru only for Yanino", () => {
    for (const branch of BRANCHES) {
      if (branch.code === "YANINO") {
        expect(branch.baseUrl).toBe("https://codorobot.ru");
      } else {
        expect(branch.baseUrl).toBe("https://codologia-vsev.ru");
      }
    }
  });
});
