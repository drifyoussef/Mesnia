// Calendar dates ("YYYY-MM-DD") as the household lives them: in French time, whatever the
// server's own time zone (Render runs in UTC, so "today" would change at 1 or 2 am otherwise).

const TIME_ZONE = 'Europe/Paris';

/** "YYYY-MM-DD" of a moment, in French time. */
function isoDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const todayIso = () => isoDate(new Date());

/** Day arithmetic on "YYYY-MM-DD" strings (done in UTC, where every day lasts 24 h). */
function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Next occurrence: +1 day, week or month (31 January + 1 month = last day of February). */
function addPeriod(iso, every) {
  if (every === 'day') return addDays(iso, 1);
  if (every === 'week') return addDays(iso, 7);
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

/** Whole days from one "YYYY-MM-DD" to another. */
const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);

module.exports = { isoDate, todayIso, addDays, addPeriod, daysBetween, TIME_ZONE };
