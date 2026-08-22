import Constants from 'expo-constants';

import basemapTemplate from '@/features/map/style/sharecropr-basemap.json';

type BasemapExtra = {
  tileOrigin?: string;
  basemapArchive?: string;
};

function resolveTemplate(value: string, tileOrigin: string, archive: string): string {
  return value
    .replaceAll('{{TILE_ORIGIN}}', tileOrigin)
    .replaceAll('{{BASEMAP_ARCHIVE}}', archive);
}

function resolveStyleValue(
  value: unknown,
  tileOrigin: string,
  archive: string,
): unknown {
  if (typeof value === 'string') {
    return resolveTemplate(value, tileOrigin, archive);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveStyleValue(item, tileOrigin, archive));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        resolveStyleValue(nested, tileOrigin, archive),
      ]),
    );
  }
  return value;
}

/** Resolves the versioned basemap style with environment-specific tile URLs (SPEC-008 R74). */
export function resolveBasemapStyle(): Record<string, unknown> {
  const extra = (Constants.expoConfig?.extra ?? {}) as BasemapExtra;
  const tileOrigin = extra.tileOrigin ?? 'https://tiles.staging.sharecropr.com';
  const archive = extra.basemapArchive ?? 'sharecropr-basemap-202608.pmtiles';

  return resolveStyleValue(basemapTemplate, tileOrigin, archive) as Record<string, unknown>;
}

export function getBasemapConfig() {
  const extra = (Constants.expoConfig?.extra ?? {}) as BasemapExtra;
  return {
    tileOrigin: extra.tileOrigin ?? 'https://tiles.staging.sharecropr.com',
    basemapArchive: extra.basemapArchive ?? 'sharecropr-basemap-202608.pmtiles',
  };
}
