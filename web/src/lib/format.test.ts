import { describe, expect, it } from 'vitest';
import { clockTime, duration, hexToRgbChannels, hourLabel, isLightColor, monthLabel, shortDate } from './format';

describe('format utilities', () => {
  describe('duration', () => {
    it('formats null/undefined as em-dash', () => {
      expect(duration(null)).toBe('—');
      expect(duration(undefined)).toBe('—');
    });

    it('formats 0s as 0m in short style', () => {
      expect(duration(0)).toBe('0m');
    });

    it('formats minutes and hours properly', () => {
      expect(duration(1500)).toBe('25m');
      expect(duration(3600)).toBe('1h');
      expect(duration(5400)).toBe('1h 30m');
    });
  });

  describe('clockTime', () => {
    it('formats time in specific timezone', () => {
      const ms = Date.UTC(2026, 8, 20, 12, 30, 0); // 12:30 UTC
      expect(clockTime(ms, 'UTC')).toBe('12:30');
    });

    it('handles empty input gracefully', () => {
      expect(clockTime(null, 'UTC')).toBe('—');
    });
  });

  describe('shortDate and monthLabel', () => {
    it('formats short date correctly', () => {
      expect(shortDate('2026-03-09')).toBe('9 Mar');
    });

    it('formats month label correctly', () => {
      expect(monthLabel('2026-03')).toBe('March 2026');
    });
  });

  describe('hourLabel', () => {
    it('formats hours with AM/PM', () => {
      expect(hourLabel(0)).toBe('12 AM');
      expect(hourLabel(9)).toBe('9 AM');
      expect(hourLabel(12)).toBe('12 PM');
      expect(hourLabel(21)).toBe('9 PM');
    });
  });

  describe('color utilities', () => {
    it('converts hex to RGB channels correctly', () => {
      expect(hexToRgbChannels('#5eead4')).toBe('94 234 212');
      expect(hexToRgbChannels('#000000')).toBe('0 0 0');
      expect(hexToRgbChannels('#ffffff')).toBe('255 255 255');
    });

    it('detects light and dark colors', () => {
      expect(isLightColor('#ffffff')).toBe(true);
      expect(isLightColor('#000000')).toBe(false);
      expect(isLightColor('#5eead4')).toBe(true);
    });
  });
});
