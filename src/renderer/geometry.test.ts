import { describe, expect, it } from 'vitest';
import { fitRect } from './geometry';

describe('fitRect', () => {
  it('contains a 16:9 slide inside a tall target', () => {
    const rect = fitRect(1600, 900, { x: 0, y: 0, w: 500, h: 800 }, 'contain');
    expect(rect.w).toBe(500);
    expect(Math.round(rect.h)).toBe(281);
    expect(Math.round(rect.y)).toBe(259);
  });

  it('covers a square target with a 16:9 slide', () => {
    const rect = fitRect(1600, 900, { x: 0, y: 0, w: 500, h: 500 }, 'cover');
    expect(Math.round(rect.w)).toBe(889);
    expect(rect.h).toBe(500);
    expect(Math.round(rect.x)).toBe(-194);
  });
});
