export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function approximateBirthdayFromAge(age: number, now = new Date()): string {
  const birthday = new Date(now);
  birthday.setFullYear(now.getFullYear() - age);
  return toIsoDate(birthday);
}
