import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
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
} from '@maplibre/maplibre-react-native';
import type { NativeSyntheticEvent } from 'react-native';

import type { Camera as MapCamera, DeviceLocation } from '@/domain/geo/types';
import { deviceLocationToGeoPoint } from '@/domain/geo/types';
import { OsmAttribution } from '@/features/map/components/OsmAttribution';
import { resolveBasemapStyle } from '@/features/map/config/basemap';
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
  onCameraChanged: (camera: MapCamera, gesture: boolean) => void;
  onMarkerPress: (id: string) => void;
  onClusterPress: (clusterId: number, lat: number, lng: number) => void;
  onMapPress: () => void;
  onFirstTilePainted?: () => void;
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
    onCameraChanged,
    onMarkerPress,
    onClusterPress,
    onMapPress,
    onFirstTilePainted,
  },
  ref,
) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const firstTileReported = useRef(false);

  const mapStyle = useMemo(
    () => resolveBasemapStyle() as unknown as StyleSpecification,
    [],
  );

  const markerSignature = useMemo(() => markerCollectionSignature(markers), [markers]);
  const markerCollection = useMemo(
    () => markersToFeatureCollection(markers),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature is the memo gate per R26
    [markerSignature],
  );

  const avatarCollection = useMemo(() => {
    if (!userLocation) return null;
    const point = deviceLocationToGeoPoint(userLocation);
    return userLocationFeature(point.lat, point.lng);
  }, [userLocation]);

  useImperativeHandle(ref, () => ({
    animateToCamera: (nextCamera, durationMs = 200) => {
      cameraRef.current?.easeTo({
        center: [nextCamera.center.lng, nextCamera.center.lat],
        zoom: nextCamera.zoom,
        duration: durationMs,
      });
    },
    animateToCoordinate: (location, durationMs = 200) => {
      const point = deviceLocationToGeoPoint(location);
      cameraRef.current?.easeTo({
        center: [point.lng, point.lat],
        duration: durationMs,
      });
    },
  }));

  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<{ center: [number, number]; zoom: number; userInteraction: boolean }>) => {
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

  const handleDidFinishRenderingMapFully = useCallback(() => {
    if (!firstTileReported.current) {
      firstTileReported.current = true;
      onFirstTilePainted?.();
    }
  }, [onFirstTilePainted]);

  return (
    <View style={styles.container} testID="map.canvas">
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={mapStyle}
        attribution={false}
        logo={false}
        onPress={onMapPress}
        onRegionDidChange={handleRegionDidChange}
        onDidFinishRenderingMapFully={handleDidFinishRenderingMapFully}
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

        {avatarCollection ? (
          <GeoJSONSource id="avatar" data={avatarCollection}>
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
        ) : null}
      </Map>

      <View style={styles.attributionSlot} pointerEvents="none">
        <OsmAttribution />
      </View>
    </View>
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
  attributionSlot: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    zIndex: 10,
  },
});
