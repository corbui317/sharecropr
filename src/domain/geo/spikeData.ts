import type { SafeSpotCategory, SafeSpotFeature } from '@/domain/geo/types';

/** Deterministic pseudo-random for reproducible spike data. */
function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES: SafeSpotCategory[] = [
  'library',
  'police',
  'city_hall',
  'community_center',
  'park',
  'other',
];

const LABELS: Record<SafeSpotCategory, string[]> = {
  library: ['Central Library', 'Branch Library', 'Reading Room'],
  police: ['Community Policing Desk', 'Precinct Lobby'],
  city_hall: ['City Hall Plaza', 'Civic Center'],
  community_center: ['Neighborhood Center', 'Rec Center Lobby'],
  park: ['Park Pavilion', 'Garden Gate'],
  other: ['Farmers Market', 'Town Square'],
};

/**
 * Generates 200 synthetic safe-spot markers around a metro centre.
 * Used only for EPIC-01 spike — not production data.
 */
export function generateSpikeMarkers(
  center: { lat: number; lng: number },
  count = 200,
  seed = 42,
): SafeSpotFeature[] {
  const rand = mulberry32(seed);
  const markers: SafeSpotFeature[] = [];

  for (let i = 0; i < count; i += 1) {
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)]!;
    const labels = LABELS[category];
    const label = labels[Math.floor(rand() * labels.length)]!;

    // Spread within ~12 km so clustering is visible at zoom 13
    const angle = rand() * Math.PI * 2;
    const radiusKm = 0.3 + rand() * 11.5;
    const latOffset = (radiusKm / 111) * Math.cos(angle);
    const lngOffset =
      (radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);

    markers.push({
      id: `spike-${i.toString().padStart(3, '0')}`,
      lat: center.lat + latOffset,
      lng: center.lng + lngOffset,
      label: `${label} #${i + 1}`,
      count: Math.floor(rand() * 12),
      category,
    });
  }

  return markers;
}
