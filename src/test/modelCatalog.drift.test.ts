// Drift tests — the frontend catalog (src/config/modelCatalog.ts) and the
// backend mirror (supabase/functions/_shared/ai/modelPreferenceResolver.ts)
// MUST stay in sync. Also verifies internal referential integrity of the
// FAMILY_TIER_PREFERENCE map and the legacy modelOptions UI catalog.

import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG as FE_CATALOG,
  FAMILY_TIER_PREFERENCE as FE_FAMILY_TIER,
  ALL_MODEL_IDS,
} from '@/config/modelCatalog';
import { modelOptions } from '@/config/modelOptions';
import {
  MODEL_CATALOG as BE_CATALOG,
  FAMILY_TIER_PREFERENCE as BE_FAMILY_TIER,
} from '../../supabase/functions/_shared/ai/modelPreferenceResolver';

describe('model catalog drift', () => {
  it('frontend and backend catalogs expose the same model IDs', () => {
    const fe = new Set(FE_CATALOG.map((m) => m.id));
    const be = new Set(BE_CATALOG.map((m: any) => m.id));
    expect([...fe].sort()).toEqual([...be].sort());
  });

  it('frontend and backend agree on plan tiers per model', () => {
    const beById = new Map(BE_CATALOG.map((m: any) => [m.id, m]));
    for (const fe of FE_CATALOG) {
      const be: any = beById.get(fe.id);
      expect(be, `missing backend entry for ${fe.id}`).toBeTruthy();
      expect([...fe.planTiers].sort()).toEqual([...be.planTiers].sort());
      expect(fe.family).toBe(be.family);
      expect(fe.provider).toBe(be.provider);
    }
  });

  it('every fallback ID exists in the catalog', () => {
    for (const m of FE_CATALOG) {
      for (const fid of m.fallbackIds) {
        expect(ALL_MODEL_IDS).toContain(fid);
      }
    }
  });

  it('every FAMILY_TIER_PREFERENCE ID exists in the catalog (frontend)', () => {
    for (const fam of Object.keys(FE_FAMILY_TIER) as Array<keyof typeof FE_FAMILY_TIER>) {
      for (const lvl of ['low', 'medium', 'high'] as const) {
        for (const id of FE_FAMILY_TIER[fam][lvl]) {
          expect(ALL_MODEL_IDS, `${fam}.${lvl}: ${id}`).toContain(id);
        }
      }
    }
  });

  it('every FAMILY_TIER_PREFERENCE ID exists in the catalog (backend mirror)', () => {
    const ids = new Set(BE_CATALOG.map((m: any) => m.id));
    for (const fam of Object.keys(BE_FAMILY_TIER) as Array<keyof typeof BE_FAMILY_TIER>) {
      for (const lvl of ['low', 'medium', 'high'] as const) {
        for (const id of BE_FAMILY_TIER[fam][lvl]) {
          expect(ids.has(id), `${fam}.${lvl}: ${id}`).toBe(true);
        }
      }
    }
  });

  it('every modelOptions entry (except "auto") exists in the catalog', () => {
    for (const opt of modelOptions) {
      if (opt.id === 'auto') continue;
      expect(ALL_MODEL_IDS, `modelOptions has unknown id: ${opt.id}`).toContain(opt.id);
    }
  });
});
