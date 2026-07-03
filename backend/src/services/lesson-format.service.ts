export type MoyKlassLesson = {
  id: number;
  classId: number;
  date: string;
  beginTime: string;
  status: number;
};

export type LessonListResult = {
  lessons: MoyKlassLesson[];
  lessonsText: string;
  maxLessonNumber: number | null;
};

type LessonListOptions = {
  includeUnavailable?: boolean;
};

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря"
];

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота"
];

export function getWeekdayName(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return WEEKDAYS[new Date(year, month - 1, day).getDay()] ?? "";
}

export function formatDate(dateStr: string): string {
  const [, monthRaw, dayRaw] = dateStr.split("-").map(Number);
  return `${dayRaw} ${MONTHS[monthRaw - 1]}`;
}

export class LessonFormatService {
  buildAvailableLessonList(lessons: MoyKlassLesson[], options: LessonListOptions = {}): LessonListResult {
    const availableLessons = options.includeUnavailable
      ? lessons
      : lessons.filter((lesson) => lesson.status === 0);
    const weekdayCount = new Set(availableLessons.map((lesson) => getWeekdayName(lesson.date))).size;
    const timeCount = new Set(availableLessons.map((lesson) => lesson.beginTime)).size;
    const maxCount = timeCount > 1 ? 6 : weekdayCount > 1 ? 4 : 2;
    const selected = availableLessons.slice(0, maxCount);

    if (selected.length === 0) {
      return {
        lessons: [],
        lessonsText: "Сейчас нет доступных пробных занятий.",
        maxLessonNumber: null
      };
    }

    const lessonsText = selected
      .map((lesson, index) => {
        return `${index + 1}. ${formatDate(lesson.date)} в ${lesson.beginTime} ${getWeekdayName(
          lesson.date
        )}`;
      })
      .join("\n");

    return {
      lessons: selected,
      lessonsText,
      maxLessonNumber: selected.length
    };
  }
}
