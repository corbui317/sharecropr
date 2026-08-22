/** Geographic point — seam-neutral naming per ADR-0019. */
export type GeoPoint = {
  lat: number;
  lng: number;
};

/** MapLibre camera — center + zoom, not latitudeDelta/longitudeDelta (ADR-0019). */
export type Camera = {
  center: GeoPoint;
  /** MapLibre zoom level (0–20). Zoom 13 ≈ 8 km visible radius (SPEC-008 R01). */
  zoom: number;
};

export type SafeSpotCategory =
  | 'library'
  | 'police'
  | 'city_hall'
  | 'community_center'
  | 'park'
  | 'other';

export type SafeSpotFeature = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  count: number;
  category: SafeSpotCategory;
};

/** Closed property set for marker features crossing the MapCanvas seam (SPEC-008 R69). */
export type SpotProps = {
  id: string;
  label: string;
  listing_count: number;
  category: SafeSpotCategory;
  selected: boolean;
};

export type RenderableSpotMarker = {
  kind: 'spot';
  id: string;
  lat: number;
  lng: number;
  listing_count: number;
  category: SafeSpotCategory;
  label: string;
  selected: boolean;
};

export type RenderableClusterMarker = {
  kind: 'cluster';
  id: string;
  lat: number;
  lng: number;
  pointCount: number;
  listing_count: number;
  clusterId: number;
};

export type RenderableMarker = RenderableSpotMarker | RenderableClusterMarker;

export const DEFAULT_ZOOM = 13;

/** Device location before quantization — converted at the seam boundary only. */
export type DeviceLocation = {
  latitude: number;
  longitude: number;
};

export function deviceLocationToGeoPoint(location: DeviceLocation): GeoPoint {
  return { lat: location.latitude, lng: location.longitude };
}

export function bboxOfCamera(camera: Camera): [number, number, number, number] {
  const latSpan = 360 / Math.pow(2, camera.zoom);
  const lngSpan = latSpan / Math.max(Math.cos((camera.center.lat * Math.PI) / 180), 0.01);
  return [
    camera.center.lng - lngSpan / 2,
    camera.center.lat - latSpan / 2,
    camera.center.lng + lngSpan / 2,
    camera.center.lat + latSpan / 2,
  ];
}

export function availabilityBand(
  listingCount: number,
): 'empty' | 'some' | 'many' {
  if (listingCount === 0) return 'empty';
  if (listingCount < 5) return 'some';
  return 'many';
}
