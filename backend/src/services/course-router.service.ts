import type { BotCourseCode } from "@prisma/client";
import {
  COURSE_OPTION_LABELS,
  type PrimaryCourseOption,
  type SubCourseOption
} from "../domain/catalog.js";

export type CourseOption = {
  key: PrimaryCourseOption;
  label: string;
};

export type CourseResolution =
  | { kind: "course"; courseCode: BotCourseCode }
  | { kind: "needs_subchoice"; options: Array<{ key: SubCourseOption; label: string }> };

export class CourseRouterService {
  getAvailableOptions(age: number): CourseOption[] {
    if (!Number.isInteger(age) || age < 5 || age > 17) {
      return [];
    }

    const options: PrimaryCourseOption[] = ["start"];

    if (age >= 5 && age <= 12) options.push("robotics");
    if (age >= 5 && age <= 8) options.push("math");
    if (age >= 8 && age <= 17) options.push("design", "games");
    if (age >= 11 && age <= 17) options.push("programming");

    return options.map((key) => ({ key, label: COURSE_OPTION_LABELS[key] }));
  }

  resolveCourse(
    age: number,
    selectedOption: PrimaryCourseOption,
    subChoice?: SubCourseOption
  ): CourseResolution {
    if (!this.getAvailableOptions(age).some((option) => option.key === selectedOption)) {
      throw new Error(`Course option ${selectedOption} is not available for age ${age}`);
    }

    if (selectedOption === "start") return { kind: "course", courseCode: "DIGITAL_LITERACY" };
    if (selectedOption === "design") return { kind: "course", courseCode: "DESIGN" };
    if (selectedOption === "programming") return { kind: "course", courseCode: "PYTHON" };

    if (selectedOption === "math") {
      return { kind: "course", courseCode: age <= 6 ? "MATH_1" : "MATH_2" };
    }

    if (selectedOption === "robotics") {
      if (age < 8) return { kind: "course", courseCode: "WEDO" };
      if (subChoice === "ev3") return { kind: "course", courseCode: "EV3" };
      if (subChoice === "arduino") return { kind: "course", courseCode: "ARDUINO" };
      return {
        kind: "needs_subchoice",
        options: [
          { key: "ev3", label: COURSE_OPTION_LABELS.ev3 },
          { key: "arduino", label: COURSE_OPTION_LABELS.arduino }
        ]
      };
    }

    if (selectedOption === "games") {
      if (age <= 11) return { kind: "course", courseCode: "ROBLOX" };
      if (age >= 13) return { kind: "course", courseCode: "UNITY" };
      if (subChoice === "roblox") return { kind: "course", courseCode: "ROBLOX" };
      if (subChoice === "unity") return { kind: "course", courseCode: "UNITY" };
      return {
        kind: "needs_subchoice",
        options: [
          { key: "roblox", label: COURSE_OPTION_LABELS.roblox },
          { key: "unity", label: COURSE_OPTION_LABELS.unity }
        ]
      };
    }

    throw new Error(`Unsupported course option: ${selectedOption}`);
  }
}
