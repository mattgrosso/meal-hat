import { describe, it, expect } from 'vitest';
import { formatBuildTime, buildStampText } from '../../src/utils/buildStamp.js';

// Fixed local-time instants so these don't drift with the clock or the box's
// timezone: constructed from local parts, read back as local.
const localTime = (y, m, d, h, min) => new Date(y, m - 1, d, h, min);
const NOW = localTime(2026, 8, 22, 9, 0);

describe('formatBuildTime', () => {
  it('reads as a person would say it', () => {
    expect(formatBuildTime(localTime(2026, 8, 22, 1, 32), NOW)).toBe('Aug 22, 1:32 AM');
    expect(formatBuildTime(localTime(2026, 8, 22, 13, 5), NOW)).toBe('Aug 22, 1:05 PM');
  });

  it('handles both ends of the 12-hour clock', () => {
    expect(formatBuildTime(localTime(2026, 8, 22, 0, 7), NOW)).toBe('Aug 22, 12:07 AM');
    expect(formatBuildTime(localTime(2026, 8, 22, 12, 0), NOW)).toBe('Aug 22, 12:00 PM');
  });

  it('adds the year only when it is not this one', () => {
    expect(formatBuildTime(localTime(2025, 12, 31, 23, 59), NOW)).toBe('Dec 31, 2025, 11:59 PM');
    expect(formatBuildTime(localTime(2026, 1, 1, 0, 0), NOW)).toBe('Jan 1, 12:00 AM');
  });

  it('accepts the ISO string the build injects', () => {
    const iso = localTime(2026, 8, 22, 1, 32).toISOString();
    expect(formatBuildTime(iso, NOW)).toBe('Aug 22, 1:32 AM');
  });

  it('returns null rather than a lie when there is no usable time', () => {
    expect(formatBuildTime(null, NOW)).toBeNull();
    expect(formatBuildTime(undefined, NOW)).toBeNull();
    expect(formatBuildTime('not a date', NOW)).toBeNull();
    expect(formatBuildTime('', NOW)).toBeNull();
  });
});

describe('buildStampText', () => {
  it('is the house format: version, then when it was built', () => {
    expect(
      buildStampText({ version: '1.14.0', buildTime: localTime(2026, 8, 22, 1, 32), now: NOW }),
    ).toBe('v1.14.0 · built Aug 22, 1:32 AM');
  });

  it('degrades instead of disappearing', () => {
    expect(buildStampText({ version: '1.14.0', buildTime: null, now: NOW })).toBe('v1.14.0');
    expect(buildStampText({ buildTime: localTime(2026, 8, 22, 1, 32), now: NOW })).toBe(
      'built Aug 22, 1:32 AM',
    );
    expect(buildStampText({ now: NOW })).toBe('');
    expect(buildStampText()).toBe('');
  });
});
