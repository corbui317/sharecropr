import type { Feature, FeatureCollection, Point } from 'geojson';

import type { RenderableMarker } from '@/domain/geo/types';

const CATEGORY_GLYPH: Record<string, string> = {
  library: 'L',
  police: 'P',
  city_hall: 'C',
  community_center: 'H',
  park: 'K',
  other: 'S',
};

/**
 * Builds a memoisation key for the feature collection (SPEC-008 R26).
 * New object identity only when id, listing_count, or selected changes.
 */
export function markerCollectionSignature(markers: readonly RenderableMarker[]): string {
  return markers
    .map((m) =>
      m.kind === 'spot'
        ? `s:${m.id}:${m.listing_count}:${m.selected ? 1 : 0}`
        : `c:${m.id}:${m.listing_count}`,
    )
    .join('|');
}

export function markersToFeatureCollection(
  markers: readonly RenderableMarker[],
): FeatureCollection<Point> {
  const features: Feature<Point>[] = markers.map((marker) => {
    if (marker.kind === 'cluster') {
      return {
        type: 'Feature',
        id: marker.id,
        geometry: {
          type: 'Point',
          coordinates: [marker.lng, marker.lat],
        },
        properties: {
          id: marker.id,
          listing_count: marker.listing_count,
          category: 'other',
          label: '',
          selected: false,
          kind: 'cluster',
          cluster_id: marker.clusterId,
          point_count: marker.pointCount,
        },
      };
    }

    return {
      type: 'Feature',
      id: marker.id,
      geometry: {
        type: 'Point',
        coordinates: [marker.lng, marker.lat],
      },
      properties: {
        id: marker.id,
        listing_count: marker.listing_count,
        category: marker.category,
        label: marker.label,
        selected: marker.selected,
        kind: 'spot',
        category_glyph: CATEGORY_GLYPH[marker.category] ?? 'S',
      },
    };
  });

  return { type: 'FeatureCollection', features };
}

export function userLocationFeature(
  lat: number,
  lng: number,
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'user-avatar',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { kind: 'avatar' },
      },
    ],
  };
}
