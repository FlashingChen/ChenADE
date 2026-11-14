import { describe, expect, it } from 'vitest';
import {
  fileStatusColor,
  fileStatusCode,
  relativeTime,
  shortHash,
  shortPath,
} from './format';

describe('format helpers', () => {
  it('shortens unix home paths', () => {
    expect(shortPath('/Users/alice/Code/ChenADE')).toBe('~/Code/ChenADE');
    expect(shortPath('/opt/homebrew/bin')).toBe('/opt/homebrew/bin');
  });

  it('shortens commit hashes', () => {
    expect(shortHash('b71e9de123456789')).toBe('b71e9de');
    expect(shortHash(null)).toBe('');
  });

  it('maps porcelain status to a single code', () => {
    expect(fileStatusCode(' ', 'M')).toBe('M');
    expect(fileStatusCode('A', ' ')).toBe('A');
    expect(fileStatusCode('?', '?')).toBe('?');
    expect(fileStatusCode('R', ' ')).toBe('R');
    expect(fileStatusColor('A')).toBe('var(--lime)');
  });

  it('formats relative time in chinese', () => {
    expect(relativeTime(new Date().toISOString())).toBe('刚刚');
    expect(relativeTime(null)).toBe('—');
  });
});
