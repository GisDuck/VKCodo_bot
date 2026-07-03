export function parseDeveloperToday(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function resolveTodayForDeveloperMode(
  developerMode: boolean,
  developerTodayDate: unknown,
  realToday = new Date()
): Date {
  if (!developerMode) return realToday;
  return parseDeveloperToday(developerTodayDate) ?? realToday;
}
