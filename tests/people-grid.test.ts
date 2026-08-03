import { describe, expect, test } from 'vitest';
import { loadProtocolDefinitions } from '../src/protocols/registry.js';

describe('people-grid protocol', () => {
  test('loads a def named people-grid', () => {
    const defs = loadProtocolDefinitions();
    expect(defs.has('people-grid')).toBe(true);
    expect(defs.get('people-grid')!.name).toBe('people-grid');
  });

  test('carries the triadic presentation hint', () => {
    const def = loadProtocolDefinitions().get('people-grid')!;
    expect(def.presentation).toBe('triadic');
  });

  test('targets self', () => {
    const def = loadProtocolDefinitions().get('people-grid')!;
    expect(def.targets).toContain('self');
  });

  test('has a floor probe', () => {
    const def = loadProtocolDefinitions().get('people-grid')!;
    expect(def.floorProbe).toBe('Which two of these three people are alike, and how?');
  });

  test('is user-declared only, out of the rotation pool', () => {
    const def = loadProtocolDefinitions().get('people-grid')!;
    expect(def.rotation).toBe(false);
  });

  test('existing defs carry no presentation hint', () => {
    const defs = loadProtocolDefinitions();
    for (const name of ['laddered-grid', 'cdm', 'concept-sorting']) {
      expect(defs.get(name)!.presentation, `${name}: expected no presentation`).toBeUndefined();
    }
  });
});
