// SPEC-008 R02 · SCR-0102 · SCRUM-25
import { describe, expect, test } from '@jest/globals';

import { lerpLocation, progressAt } from '@/features/map/lib/avatarInterpolation';

const A = { latitude: 45.5, longitude: -122.7 };
const B = { latitude: 45.6, longitude: -122.5 };

describe('lerpLocation', () => {
  test('t=0 is the start', () => {
    expect(lerpLocation(A, B, 0)).toEqual(A);
  });
  test('t=0.5 is the midpoint', () => {
    const m = lerpLocation(A, B, 0.5);
    expect(m.latitude).toBeCloseTo(45.55, 10);
    expect(m.longitude).toBeCloseTo(-122.6, 10);
  });
  test('t=1 is the end', () => {
    expect(lerpLocation(A, B, 1)).toEqual(B);
  });
  test('t is clamped below 0 and above 1', () => {
    expect(lerpLocation(A, B, -3)).toEqual(A);
    expect(lerpLocation(A, B, 7)).toEqual(B);
  });
});

describe('progressAt', () => {
  test('0 at start, 0.5 halfway, 1 at and after the end', () => {
    expect(progressAt(1000, 1000, 200)).toBe(0);
    expect(progressAt(1000, 1100, 200)).toBe(0.5);
    expect(progressAt(1000, 1200, 200)).toBe(1);
    expect(progressAt(1000, 5000, 200)).toBe(1);
  });
  test('zero duration is immediately complete', () => {
    expect(progressAt(1000, 1000, 0)).toBe(1);
  });
});
