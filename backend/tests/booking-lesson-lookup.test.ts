import { describe, expect, it, vi } from "vitest";

describe("BookingService lesson lookup", () => {
  it("does not request lessons when MoyKlass has no classes for branch and course", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("BASE_URL", "https://bot.example.ru");
    vi.stubEnv("MOYKLASS_API_KEY", "test");
    vi.stubEnv("TBANK_TERMINAL_KEY", "test");
    vi.stubEnv("TBANK_PASSWORD", "test");

    const { BookingService } = await import("../src/services/booking.service.js");

    const db = {
      branch: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ moyklassId: 25020 })
      },
      botCourse: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          mapping: { moyklassCourseId: 170128 }
        })
      },
      appSetting: {
        findUnique: vi.fn()
      }
    };
    const moyKlass = {
      getClasses: vi.fn().mockResolvedValue([]),
      getLessons: vi.fn()
    };

    const service = new BookingService(db as never, moyKlass as never, {} as never);
    const result = await service.getAvailableLessons("branch-1", "WEDO");

    expect(result).toMatchObject({
      lessons: [],
      lessonsText: "",
      maxLessonNumber: null,
      hasCourseInBranch: false
    });
    expect(moyKlass.getClasses).toHaveBeenCalledWith(25020, 170128);
    expect(moyKlass.getLessons).not.toHaveBeenCalled();
    expect(db.appSetting.findUnique).not.toHaveBeenCalled();
  });
});
