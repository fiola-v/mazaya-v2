const DATE_ONLY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_FORMAT.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && toDateOnly(parsed) === value;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
