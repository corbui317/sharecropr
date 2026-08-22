import { useMemo } from 'react';
import Supercluster from 'supercluster';

import type {
  Camera,
  RenderableMarker,
  SafeSpotFeature,
  SpotProps,
} from '@/domain/geo/types';
import { bboxOfCamera } from '@/domain/geo/types';

const CLUSTER_OPTIONS = {
  radius: 56,
  maxZoom: 15,
  minZoom: 3,
  minPoints: 3,
  extent: 512,
} as const;

function toGeoJson(features: readonly SafeSpotFeature[]) {
  return features.map((spot) => ({
    type: 'Feature' as const,
    properties: {
      id: spot.id,
      label: spot.label,
      listing_count: spot.count,
      category: spot.category,
      selected: false,
    } satisfies SpotProps,
    geometry: {
      type: 'Point' as const,
      coordinates: [spot.lng, spot.lat] as [number, number],
    },
  }));
}

export function useMapMarkers(
  spots: readonly SafeSpotFeature[],
  camera: Camera,
  selectedId: string | null,
): RenderableMarker[] {
  const index = useMemo(() => {
    const cluster = new Supercluster<SpotProps>(CLUSTER_OPTIONS);
    cluster.load(toGeoJson(spots));
    return cluster;
  }, [spots]);

  return useMemo(() => {
    const bbox = bboxOfCamera(camera);
    const zoom = Math.round(camera.zoom);
    const clusters = index.getClusters(bbox, zoom);

    return clusters.map((feature): RenderableMarker => {
      const [lng, lat] = feature.geometry.coordinates as [number, number];

      if ('cluster' in feature.properties && feature.properties.cluster) {
        const clusterId = feature.id as number;
        const leaves = index.getLeaves(clusterId, Infinity);
        const summedListings = leaves.reduce(
          (sum, leaf) => sum + (leaf.properties as SpotProps).listing_count,
          0,
        );

        return {
          kind: 'cluster',
          id: `cluster-${String(clusterId)}`,
          lat,
          lng,
          pointCount: (feature.properties as { point_count: number }).point_count,
          listing_count: summedListings,
          clusterId,
        };
      }

      const props = feature.properties as SpotProps;
      return {
        kind: 'spot',
        id: props.id,
        lat,
        lng,
        listing_count: props.listing_count,
        category: props.category,
        label: props.label,
        selected: props.id === selectedId,
      };
    });
  }, [index, camera, selectedId]);
}

export function buildClusterIndex(spots: readonly SafeSpotFeature[]) {
  const cluster = new Supercluster<SpotProps>(CLUSTER_OPTIONS);
  cluster.load(toGeoJson(spots));
  return cluster;
}
