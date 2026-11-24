export interface TimeZoneOption {
  value: string;
  label: string;
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  weekday: number;
  isoWeekday: number;
  dateStr: string;
}

export const SUPPORTED_TIMEZONES: readonly TimeZoneOption[] = [
  { value: 'Europe/Kyiv', label: 'Europe/Kyiv (Київ)' },
  { value: 'Europe/Warsaw', label: 'Europe/Warsaw (Варшава)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (Берлін)' },
  { value: 'Europe/London', label: 'Europe/London (Лондон)' },
  { value: 'UTC', label: 'UTC (Всесвітній час)' },
  { value: 'America/New_York', label: 'America/New_York (Нью-Йорк)' },
  { value: 'America/Chicago', label: 'America/Chicago (Чикаго)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (Лос-Анджелес)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (Дубай)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (Токіо)' },
];

export function resolveTimeZone(tz?: string | null): string {
  const candidate = (tz ?? '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv';
  const normalized = candidate === 'Europe/Kiev' ? 'Europe/Kyiv' : candidate;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: normalized });
    return normalized;
  } catch {
    return 'Europe/Kyiv';
  }
}

export function getZonedDateParts(date: Date, timeZone?: string | null): ZonedDateParts {
  const tz = resolveTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hours = read('hour') % 24;
  const minutes = read('minute');

  const localDate = new Date(year, month - 1, day);
  const weekday = localDate.getDay();
  const isoWeekday = weekday === 0 ? 7 : weekday;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hours, minutes, weekday, isoWeekday, dateStr };
}

export function getTimeZoneOptions(currentTz?: string | null): TimeZoneOption[] {
  const resolved = resolveTimeZone(currentTz);
  if (SUPPORTED_TIMEZONES.some((o) => o.value === resolved)) {
    return [...SUPPORTED_TIMEZONES];
  }
  return [{ value: resolved, label: resolved }, ...SUPPORTED_TIMEZONES];
}
