import { describe, expect, it } from "vitest";
import { CourseRouterService } from "../src/services/course-router.service.js";

const service = new CourseRouterService();

describe("CourseRouterService", () => {
  it.each([
    [5, ["start", "robotics", "math"]],
    [6, ["start", "robotics", "math"]],
    [7, ["start", "robotics", "math"]],
    [8, ["start", "robotics", "math", "design", "games"]],
    [10, ["start", "robotics", "design", "games"]],
    [11, ["start", "robotics", "design", "games", "programming"]],
    [12, ["start", "robotics", "design", "games", "programming"]],
    [13, ["start", "design", "games", "programming"]],
    [17, ["start", "design", "games", "programming"]]
  ])("returns available options for age %s", (age, expected) => {
    expect(service.getAvailableOptions(age).map((item) => item.key)).toEqual(expected);
  });

  it("resolves age-specific courses", () => {
    expect(service.resolveCourse(5, "math")).toEqual({ kind: "course", courseCode: "MATH_1" });
    expect(service.resolveCourse(7, "math")).toEqual({ kind: "course", courseCode: "MATH_2" });
    expect(service.resolveCourse(6, "robotics")).toEqual({ kind: "course", courseCode: "WEDO" });
    expect(service.resolveCourse(8, "robotics").kind).toBe("needs_subchoice");
    expect(service.resolveCourse(8, "robotics", "arduino")).toEqual({
      kind: "course",
      courseCode: "ARDUINO"
    });
    expect(service.resolveCourse(11, "games")).toEqual({ kind: "course", courseCode: "ROBLOX" });
    expect(service.resolveCourse(12, "games").kind).toBe("needs_subchoice");
    expect(service.resolveCourse(13, "games")).toEqual({ kind: "course", courseCode: "UNITY" });
  });
});
