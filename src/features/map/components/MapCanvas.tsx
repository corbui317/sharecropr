import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type MapRef,
  type PressEventWithFeatures,
  type StyleSpecification,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { NativeSyntheticEvent } from 'react-native';

import type { Camera as MapCamera, DeviceLocation } from '@/domain/geo/types';
import { deviceLocationToGeoPoint } from '@/domain/geo/types';
import { OsmAttribution } from '@/features/map/components/OsmAttribution';
import { resolveBasemapStyle } from '@/features/map/config/basemap';
import { useInterpolatedLocation } from '@/features/map/hooks/useInterpolatedLocation';
import { FOLLOW_ANIMATION_MS } from '@/features/map/lib/followMode';
import {
  EMPTY_RENDER_MILESTONES,
  markFrameRendered,
  markMilestone,
  type RenderMilestones,
} from '@/features/map/lib/renderMilestones';
import {
  markerCollectionSignature,
  markersToFeatureCollection,
  userLocationFeature,
} from '@/features/map/lib/markerFeatureCollection';
import type { RenderableMarker } from '@/domain/geo/types';

export type { MapCamera as Camera };

export type MapCanvasProps = {
  camera: MapCamera;
  markers: readonly RenderableMarker[];
  userLocation: DeviceLocation | null;
  styleUrl?: string;
  /** Chrome (HUD, controls). Laid out in the overlay region above the attribution strip and clipped to it (SPEC-008 R76). */
  children?: React.ReactNode;
  /** Height owned by UI below the map chrome (e.g. the sheet at its current detent). The attribution sits directly above it. */
  bottomInset?: number;
  onCameraChanged: (camera: MapCamera, gesture: boolean) => void;
  /** User pan/pinch/rotate began; follow mode clears here (R04). Programmatic moves never call it (R05). */
  onGestureStart: () => void;
  onMarkerPress: (id: string) => void;
  onClusterPress: (clusterId: number, lat: number, lng: number) => void;
  onMapPress: () => void;
  /** Render milestones in ms since this component mounted (SPEC-008 R73). Called when one changes. */
  onRenderMilestones?: (milestones: RenderMilestones) => void;
  /** Called on every MapLibre frame-render completion (profiler only; omit in production). */
  onMapFrameRendered?: () => void;
};

export type MapCanvasHandle = {
  animateToCamera: (camera: MapCamera, durationMs?: number) => void;
  animateToCoordinate: (location: DeviceLocation, durationMs?: number) => void;
};

function toMapCamera(viewState: {
  center: [number, number];
  zoom: number;
}): MapCamera {
  return {
    center: { lng: viewState.center[0], lat: viewState.center[1] },
    zoom: viewState.zoom,
  };
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    camera,
    markers,
    userLocation,
    children,
    bottomInset = 0,
    onCameraChanged,
    onGestureStart,
    onMarkerPress,
    onClusterPress,
    onMapPress,
    onRenderMilestones,
    onMapFrameRendered,
  },
  ref,
) {
  const reserved = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const mountedAt = useRef<number | null>(null);
  const milestones = useRef<RenderMilestones>(EMPTY_RENDER_MILESTONES);

  // R73 measures from map-canvas mount, so the clock starts at this component's commit.
  useLayoutEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  const mapStyle = useMemo(
    () => resolveBasemapStyle() as unknown as StyleSpecification,
    [],
  );

  const markerSignature = useMemo(() => markerCollectionSignature(markers), [markers]);
  const markerCollection = useMemo(
    () => markersToFeatureCollection(markers),
    // Deliberately keyed on markerSignature, not markers: the signature is the memo gate per R26.
    // (eslint-plugin-react-hooks is not installed; if it is adopted, disable exhaustive-deps here.)
    [markerSignature],
  );

  useImperativeHandle(ref, () => ({
    animateToCamera: (nextCamera, durationMs = FOLLOW_ANIMATION_MS) => {
      cameraRef.current?.easeTo({
        center: [nextCamera.center.lng, nextCamera.center.lat],
        zoom: nextCamera.zoom,
        duration: durationMs,
      });
    },
    animateToCoordinate: (location, durationMs = FOLLOW_ANIMATION_MS) => {
      const point = deviceLocationToGeoPoint(location);
      cameraRef.current?.easeTo({
        center: [point.lng, point.lat],
        duration: durationMs,
      });
    },
  }));

  const handleRegionWillChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      if (event.nativeEvent.userInteraction) onGestureStart(); // R05: programmatic moves are ignored
    },
    [onGestureStart],
  );

  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center, zoom, userInteraction } = event.nativeEvent;
      onCameraChanged(toMapCamera({ center, zoom }), userInteraction);
    },
    [onCameraChanged],
  );

  const handleSourcePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = event.nativeEvent.features[0];
      if (!feature?.properties) return;

      const kind = feature.properties.kind as string | undefined;
      const id = feature.properties.id as string | undefined;

      if (kind === 'cluster' && typeof feature.properties.cluster_id === 'number') {
        const coords = feature.geometry;
        if (coords.type === 'Point') {
          const [lng, lat] = coords.coordinates;
          if (lng !== undefined && lat !== undefined) {
            onClusterPress(feature.properties.cluster_id, lat, lng);
          }
        }
        return;
      }

      if (kind === 'spot' && id) {
        onMarkerPress(id);
      }
    },
    [onClusterPress, onMarkerPress],
  );

  const msSinceMount = () =>
    mountedAt.current === null ? Number.NaN : performance.now() - mountedAt.current;

  const commitMilestones = useCallback(
    (next: RenderMilestones) => {
      if (next === milestones.current) return;
      milestones.current = next;
      onRenderMilestones?.(next);
    },
    [onRenderMilestones],
  );

  const handleDidFinishLoadingStyle = useCallback(() => {
    commitMilestones(markMilestone(milestones.current, 'styleLoaded', msSinceMount()));
  }, [commitMilestones]);

  const handleDidFinishRenderingFrame = useCallback(() => {
    commitMilestones(markFrameRendered(milestones.current, false, msSinceMount()));
    onMapFrameRendered?.();
  }, [commitMilestones, onMapFrameRendered]);

  const handleDidFinishRenderingFrameFully = useCallback(() => {
    commitMilestones(markFrameRendered(milestones.current, true, msSinceMount()));
    onMapFrameRendered?.();
  }, [commitMilestones, onMapFrameRendered]);

  const handleDidFinishRenderingMapFully = useCallback(() => {
    commitMilestones(markMilestone(milestones.current, 'mapFullyRendered', msSinceMount()));
  }, [commitMilestones]);

  return (
    <View style={styles.container} testID="map.canvas">
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={mapStyle}
        attribution={false}
        logo={false}
        onPress={onMapPress}
        onRegionWillChange={handleRegionWillChange}
        onRegionDidChange={handleRegionDidChange}
        onDidFinishRenderingMapFully={handleDidFinishRenderingMapFully}
        onDidFinishLoadingStyle={handleDidFinishLoadingStyle}
        onDidFinishRenderingFrame={handleDidFinishRenderingFrame}
        onDidFinishRenderingFrameFully={handleDidFinishRenderingFrameFully}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [camera.center.lng, camera.center.lat],
            zoom: camera.zoom,
          }}
        />

        <GeoJSONSource
          id="spots"
          data={markerCollection}
          cluster={false}
          onPress={handleSourcePress}
        >
          <Layer
            id="spot-circles"
            type="circle"
            filter={['==', ['get', 'kind'], 'spot']}
            paint={{
              'circle-radius': ['case', ['get', 'selected'], 16, 14],
              'circle-color': [
                'case',
                ['==', ['get', 'listing_count'], 0],
                '#9ca3af',
                ['<', ['get', 'listing_count'], 5],
                '#4ade80',
                '#16a34a',
              ],
              'circle-stroke-width': ['case', ['get', 'selected'], 3, 2],
              'circle-stroke-color': ['case', ['get', 'selected'], '#1e3a2f', '#ffffff'],
            }}
          />
          <Layer
            id="spot-glyphs"
            type="symbol"
            filter={['==', ['get', 'kind'], 'spot']}
            layout={{
              'text-field': [
                'format',
                ['get', 'category_glyph'],
                { 'font-scale': 0.9 },
                '\n',
                {},
                ['to-string', ['get', 'listing_count']],
                { 'font-scale': 0.75 },
              ],
              'text-size': 11,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-font': ['Open Sans Regular'],
            }}
            paint={{
              'text-color': '#1e3a2f',
            }}
          />
          <Layer
            id="cluster-circles"
            type="circle"
            filter={['==', ['get', 'kind'], 'cluster']}
            paint={{
              'circle-radius': 20,
              'circle-color': '#1e3a2f',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            }}
          />
          <Layer
            id="cluster-counts"
            type="symbol"
            filter={['==', ['get', 'kind'], 'cluster']}
            layout={{
              'text-field': ['to-string', ['get', 'listing_count']],
              'text-size': 13,
              'text-font': ['Open Sans Bold'],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#ffffff',
            }}
          />
        </GeoJSONSource>

        {userLocation ? <AvatarSource location={userLocation} /> : null}
      </Map>

      {/* SPEC-008 R75/R76, NFR-99: the notice is guaranteed by LAYOUT, not z-order. Chrome (children)
          is confined to the overlay region; the attribution owns an in-flow strip directly above the
          reserved bottom inset (sheet). Nothing in this tree can be laid out over it. */}
      <View style={styles.chrome} pointerEvents="box-none" testID="map.chrome">
        <View style={styles.overlay} pointerEvents="box-none" testID="map.overlay">
          {children}
        </View>
        <View style={styles.attributionInset} pointerEvents="none" testID="map.attribution-inset">
          <OsmAttribution />
        </View>
        <View
          style={[styles.reservedBottom, { height: reserved }]}
          pointerEvents="none"
          testID="map.reserved-bottom"
        />
      </View>
    </View>
  );
});

// Own subtree so per-frame interpolation re-renders only the avatar, never the spot source (R09, R26).
// Kept here because it renders GeoJSONSource/Layer and this is the sole @maplibre import site.
const AvatarSource = memo(function AvatarSource({ location }: { location: DeviceLocation }) {
  const shown = useInterpolatedLocation(location);
  const collection = useMemo(() => {
    if (!shown) return null;
    const point = deviceLocationToGeoPoint(shown);
    return userLocationFeature(point.lat, point.lng);
  }, [shown]);
  if (!collection) return null;
  return (
    <GeoJSONSource id="avatar" data={collection}>
      <Layer
        id="avatar-halo"
        type="circle"
        paint={{
          'circle-radius': 12,
          'circle-color': 'rgba(59, 130, 246, 0.25)',
        }}
      />
      <Layer
        id="avatar-dot"
        type="circle"
        paint={{
          'circle-radius': 6,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        }}
      />
    </GeoJSONSource>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#e8ede9',
  },
  map: {
    flex: 1,
  },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
  },
  overlay: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  attributionInset: {
    flexShrink: 0,
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reservedBottom: {
    flexShrink: 1,
  },
});
