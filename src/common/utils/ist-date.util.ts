// India has no daylight-saving time, so a fixed +5:30 offset is always
// correct — no need for a full timezone library (Intl.DateTimeFormat with
// timeZone: 'Asia/Kolkata' would also work, but this is dependency-free and
// trivially testable).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface IstBusinessDate {
  /** IST calendar date as YYYY-MM-DD, e.g. "2026-09-02". */
  dateString: string;
  /** UTC instant of 00:00:00.000 IST on this date. */
  startUtc: Date;
  /** UTC instant of 23:59:59.999 IST on this date. */
  endUtc: Date;
}

/**
 * Resolves the IST calendar date (and its UTC start/end instants) for a
 * given moment — defaults to "now". Used wherever "today" needs to mean
 * the business day in India rather than the server's local/UTC day.
 */
export function getIstBusinessDate(at: Date = new Date()): IstBusinessDate {
  const istShifted = new Date(at.getTime() + IST_OFFSET_MS);

  const year = istShifted.getUTCFullYear();
  const month = istShifted.getUTCMonth();
  const day = istShifted.getUTCDate();

  const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const startUtc = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endUtc = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);

  return { dateString, startUtc, endUtc };
}
