import { describe, expect, it } from "vitest";
import { LessonFormatService, type MoyKlassLesson } from "../src/services/lesson-format.service.js";

const service = new LessonFormatService();

function lesson(id: number, date: string, beginTime = "15:00", status = 0): MoyKlassLesson {
  return { id, classId: 100 + id, date, beginTime, status };
}

describe("LessonFormatService", () => {
  it("returns two options when weekday and time are the same", () => {
    const result = service.buildAvailableLessonList([
      lesson(1, "2026-07-06"),
      lesson(2, "2026-07-06"),
      lesson(3, "2026-07-06")
    ]);
    expect(result.lessons).toHaveLength(2);
    expect(result.lessonsText).toContain("1. 6 июля в 15:00 понедельник");
  });

  it("returns four options when weekdays differ", () => {
    const result = service.buildAvailableLessonList([
      lesson(1, "2026-07-06"),
      lesson(2, "2026-07-07"),
      lesson(3, "2026-07-08"),
      lesson(4, "2026-07-09"),
      lesson(5, "2026-07-10")
    ]);
    expect(result.lessons).toHaveLength(4);
  });

  it("returns six options when times differ", () => {
    const result = service.buildAvailableLessonList([
      lesson(1, "2026-07-06", "10:00"),
      lesson(2, "2026-07-06", "11:00"),
      lesson(3, "2026-07-06", "12:00"),
      lesson(4, "2026-07-06", "13:00"),
      lesson(5, "2026-07-06", "14:00"),
      lesson(6, "2026-07-06", "15:00"),
      lesson(7, "2026-07-06", "16:00")
    ]);
    expect(result.lessons).toHaveLength(6);
  });

  it("ignores unavailable lessons", () => {
    const result = service.buildAvailableLessonList([lesson(1, "2026-07-06", "15:00", 1)]);
    expect(result.lessons).toHaveLength(0);
    expect(result.maxLessonNumber).toBeNull();
  });

  it("can include unavailable lessons for developer mode", () => {
    const result = service.buildAvailableLessonList([lesson(1, "2026-07-06", "15:00", 1)], {
      includeUnavailable: true
    });
    expect(result.lessons).toHaveLength(1);
    expect(result.lessonsText).toContain("1. 6 июля в 15:00 понедельник");
  });
});
