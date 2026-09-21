import { describe, expect, it } from 'vitest';
import { rank } from './CommandPalette';

describe('CommandPalette rank', () => {
  const items = [
    { label: 'Start focus session', group: 'Timer', keywords: 'begin work timer pomodoro' },
    { label: 'Pause timer', group: 'Timer', keywords: 'stop pause' },
    { label: 'Resume timer', group: 'Timer', keywords: 'continue resume' },
    { label: 'Take a break', group: 'Timer', keywords: 'rest break' },
    { label: 'Open the cockpit', group: 'Go to', keywords: 'cockpit home' },
    { label: 'Open insights', group: 'Go to', keywords: 'insights analytics' },
    { label: 'Open tasks', group: 'Go to', keywords: 'tasks todos' },
    { label: 'Open subjects', group: 'Go to', keywords: 'subjects projects' },
    { label: 'Toggle fullscreen', group: 'Settings', keywords: 'maximize screen display' },
    { label: 'Toggle focus mode', group: 'Settings', keywords: 'focus zen' },
    { label: 'Focus on Machine Learning', group: 'Start focus on', keywords: 'Machine Learning AI ML' },
  ];

  it('returns all items unmodified when query is empty', () => {
    const results = rank(items, '');
    expect(results.length).toBe(items.length);
    expect(results).toEqual(items);
  });

  it('filters and ranks items matching label subsequence', () => {
    const results = rank(items, 'start');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].label).toBe('Start focus session');
  });

  it('matches against keywords', () => {
    const results = rank(items, 'pomodoro');
    expect(results.length).toBe(1);
    expect(results[0].label).toBe('Start focus session');
  });

  it('finds navigation destinations easily', () => {
    const results = rank(items, 'insights');
    expect(results[0].label).toBe('Open insights');
  });

  it('finds fullscreen toggle', () => {
    const results = rank(items, 'fullscreen');
    expect(results[0].label).toBe('Toggle fullscreen');
  });

  it('returns empty array when nothing matches', () => {
    const results = rank(items, 'xyznonexistent123');
    expect(results).toEqual([]);
  });
});
