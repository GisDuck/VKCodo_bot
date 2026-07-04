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

const SHORT_WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function formatMessageDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function formatMessageLessonDate(date: Date, beginTime?: string | null): string {
  const time = beginTime ? ` ${beginTime}` : "";
  return `${formatMessageDate(date)}${time} ${SHORT_WEEKDAYS[date.getDay()]}`;
}

export function formatMessageLessonDateFromIso(date: string, beginTime?: string | null): string {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  return formatMessageLessonDate(new Date(year, month - 1, day), beginTime);
}
