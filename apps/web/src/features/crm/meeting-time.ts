export function dateInZone(value: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function localInZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}

export function instantInZone(local: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const nominal = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(nominal)) return null;
  const matches: number[] = [];
  for (let minutes = -840; minutes <= 840; minutes += 15) {
    const candidate = new Date(nominal + minutes * 60_000);
    if (localInZone(candidate.toISOString(), timeZone) === local) matches.push(candidate.getTime());
  }
  return matches.length ? new Date(Math.min(...matches)).toISOString() : null;
}

export function shiftDate(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return shiftDate(day, -(weekday === 0 ? 6 : weekday - 1));
}

export function formatMeetingTime(value: string, timeZone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(value));
}
