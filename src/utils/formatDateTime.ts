const TIME_24H_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const TIME_12H_PATTERN = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type FormatAttendanceTimeOptions = {
  /** Attendance date used to interpret server UTC clock times (YYYY-MM-DD). */
  date?: string | Date | null;
};

function formatHoursMinutesTo12Hour(hours24: number, minutes: number): string {
  const period = hours24 >= 12 ? 'PM' : 'AM';
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function normalize12HourText(text: string): string {
  const match = text.match(TIME_12H_PATTERN);
  if (!match) return text;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (hours === 0) hours = 12;
  else if (hours > 12) hours %= 12;

  return `${hours}:${minutes} ${period}`;
}

function formatDateTo12HourTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function toDateKey(date: string | Date): string {
  if (date instanceof Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return date.split('T')[0].split(' ')[0];
}

function hasExplicitTimezone(text: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text.trim());
}

/** Parses ISO / datetime strings as UTC when no timezone is present. */
function parseUtcInstant(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed || !/[:t]/i.test(trimmed)) return null;
  if (ISO_DATE_PATTERN.test(trimmed)) return null;

  let normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  if (!hasExplicitTimezone(normalized)) {
    normalized = `${normalized}Z`;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parse24HourParts(text: string): { hours: number; minutes: number } | null {
  const match = text.match(TIME_24H_PATTERN);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function parse12HourParts(text: string): { hours: number; minutes: number } | null {
  const match = text.match(TIME_12H_PATTERN);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/** Interprets a clock-only server value as UTC on the given attendance date. */
function parseUtcClockOnDate(timeText: string, dateContext: string | Date): Date | null {
  const parts = parse12HourParts(timeText) ?? parse24HourParts(timeText);
  if (!parts) return null;

  const dateKey = toDateKey(dateContext);
  const iso = `${dateKey}T${String(parts.hours).padStart(2, '0')}:${String(parts.minutes).padStart(2, '0')}:00Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveAttendanceInstant(
  value: unknown,
  options?: FormatAttendanceTimeOptions,
): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text || text === '-') return null;

  const isoInstant = parseUtcInstant(text);
  if (isoInstant) return isoInstant;

  const dateContext = options?.date ?? new Date();
  const clockInstant = parseUtcClockOnDate(text, dateContext);
  if (clockInstant) return clockInstant;

  return null;
}

/** Formats local schedule times (batch timings) without UTC conversion. */
export function formatScheduleTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '—';
    return formatDateTo12HourTime(value);
  }

  const text = String(value).trim();
  if (!text || text === '-') return text === '-' ? '-' : '—';

  if (/\b(AM|PM)\b/i.test(text)) {
    return normalize12HourText(text);
  }

  const timeMatch = text.match(TIME_24H_PATTERN);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return formatHoursMinutesTo12Hour(hours, minutes);
    }
  }

  const instant = parseUtcInstant(text);
  if (instant) return formatDateTo12HourTime(instant);

  return text;
}

/** Formats attendance timestamps from UTC/server time to device local 12-hour time. */
export function formatAttendanceTime(value: unknown, options?: FormatAttendanceTimeOptions): string {
  if (value === null || value === undefined || value === '') return '—';

  const instant = resolveAttendanceInstant(value, options);
  if (instant) return formatDateTo12HourTime(instant);

  const text = String(value).trim();
  if (!text || text === '-') return text === '-' ? '-' : '—';
  return text;
}

/** Formats attendance date+time values from UTC/server time to device local time. */
export function formatAttendanceDateTime(
  value: unknown,
  options?: FormatAttendanceTimeOptions,
): string {
  if (value === null || value === undefined || value === '') return '—';

  const instant = resolveAttendanceInstant(value, options);
  if (instant) {
    return instant.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  return formatAttendanceTime(value, options);
}

/** Formats attendance check-in/out ranges in local 12-hour time. */
export function formatAttendanceTimeRange(
  start: unknown,
  end: unknown,
  options?: FormatAttendanceTimeOptions,
): string {
  const startText = formatAttendanceTime(start, options);
  const endText = formatAttendanceTime(end, options);
  if (startText === '—' && endText === '—') return '—';
  return `${startText} – ${endText}`;
}

/** Formats batch schedule ranges without UTC conversion. */
export function formatScheduleTimeRange(start: unknown, end: unknown): string {
  const startText = formatScheduleTime(start);
  const endText = formatScheduleTime(end);
  if (startText === '—' && endText === '—') return '—';
  return `${startText} – ${endText}`;
}

/** Formats batch schedule text from either a combined range or separate start/end values. */
export function formatBatchScheduleTiming(timing: unknown, start?: unknown, end?: unknown): string {
  const hasStart = start !== undefined && start !== null && String(start).trim() !== '';
  const hasEnd = end !== undefined && end !== null && String(end).trim() !== '';
  if (hasStart || hasEnd) {
    return formatScheduleTimeRange(start, end);
  }

  const text = String(timing ?? '').trim();
  if (!text || text === '-') return text === '-' ? '-' : '—';

  const parts = text.split(/\s*[–-]\s*/);
  if (parts.length === 2) {
    return formatScheduleTimeRange(parts[0], parts[1]);
  }

  return formatScheduleTime(text);
}
