import { getMonday, toIsoDate } from './date.utils';

describe('date.utils', () => {
  describe('getMonday', () => {
    it('returns the Monday of the same week, at midnight', () => {
      // Wednesday 29 October 2025, mid-afternoon
      const monday = getMonday(new Date(2025, 9, 29, 15, 30));
      expect(toIsoDate(monday)).toBe('2025-10-27');
      expect(monday.getHours()).toBe(0);
      expect(monday.getMinutes()).toBe(0);
    });

    it('treats Sunday as the end of the week, not the start', () => {
      expect(toIsoDate(getMonday(new Date(2025, 10, 2)))).toBe('2025-10-27');
    });

    it('keeps a Monday as is', () => {
      expect(toIsoDate(getMonday(new Date(2025, 9, 27, 8)))).toBe('2025-10-27');
    });

    it('crosses month and year boundaries', () => {
      // Thursday 1 January 2026
      expect(toIsoDate(getMonday(new Date(2026, 0, 1)))).toBe('2025-12-29');
    });

    it('does not modify the given date', () => {
      const date = new Date(2025, 9, 29, 15, 30);
      getMonday(date);
      expect(date.getDate()).toBe(29);
      expect(date.getHours()).toBe(15);
    });
  });

  describe('toIsoDate', () => {
    it('pads month and day with zeros', () => {
      expect(toIsoDate(new Date(2026, 2, 5))).toBe('2026-03-05');
    });

    it('uses the local date, not UTC', () => {
      // 23:30 local time must stay on the same day whatever the time zone
      expect(toIsoDate(new Date(2026, 5, 15, 23, 30))).toBe('2026-06-15');
    });
  });
});
