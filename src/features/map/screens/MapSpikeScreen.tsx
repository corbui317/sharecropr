import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { generateSpikeMarkers } from '@/domain/geo/spikeData';
import { DEFAULT_ZOOM, type Camera, type DeviceLocation } from '@/domain/geo/types';
import { MapCanvas, type MapCanvasHandle } from '@/features/map/components/MapCanvas';
import { useFpsProfiler } from '@/features/map/hooks/useFpsProfiler';
import { useFollowMode } from '@/features/map/hooks/useFollowMode';
import { buildClusterIndex, useMapMarkers } from '@/features/map/hooks/useMapMarkers';

/** Portland, OR — launch metro one placeholder for spike data. */
const SPIKE_CENTER = { lat: 45.5152, lng: -122.6784 };

function initialCamera(center = SPIKE_CENTER): Camera {
  return { center, zoom: DEFAULT_ZOOM };
}

export function MapSpikeScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapCanvasHandle>(null);
  const mountTime = useRef(Date.now());
  const [timeToFirstTileMs, setTimeToFirstTileMs] = useState<number | null>(null);

  const spots = useMemo(() => generateSpikeMarkers(SPIKE_CENTER, 200), []);

  const [camera, setCamera] = useState<Camera>(() => initialCamera());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clusterIndex = useMemo(() => buildClusterIndex(spots), [spots]);
  const markers = useMapMarkers(spots, camera, selectedId);

  const profiler = useFpsProfiler();

  const handleAnimateToUser = useCallback((location: DeviceLocation) => {
    mapRef.current?.animateToCoordinate(location, 200);
  }, []);

  const follow = useFollowMode({ onAnimateToUser: handleAnimateToUser });

  const handleCameraChanged = useCallback(
    (nextCamera: Camera, gesture: boolean) => {
      setCamera(nextCamera);
      if (gesture) {
        follow.onUserGesture();
      }
    },
    [follow],
  );

  const handleClusterPress = useCallback(
    (clusterId: number, lat: number, lng: number) => {
      const expansionZoom = clusterIndex.getClusterExpansionZoom(clusterId);
      mapRef.current?.animateToCamera(
        {
          center: { lat, lng },
          zoom: expansionZoom,
        },
        300,
      );
    },
    [clusterIndex],
  );

  const handleFirstTilePainted = useCallback(() => {
    setTimeToFirstTileMs(Date.now() - mountTime.current);
  }, []);

  const handleExportTrace = useCallback(async () => {
    const summary = profiler.getSummary();
    const payload = {
      epic: 'EPIC-01',
      renderer: '@maplibre/maplibre-react-native',
      story: 'SCR-0103',
      timestamp: new Date().toISOString(),
      markerCount: spots.length,
      visibleFeatures: markers.length,
      timeToFirstTileMs,
      summary,
      note: 'Profile on reference Android hardware. Attach device model and OS version.',
    };

    try {
      await Share.share({
        message: JSON.stringify(payload, null, 2),
        title: 'Map spike FPS trace',
      });
    } catch {
      Alert.alert('Trace ready', JSON.stringify(summary, null, 2));
    }
  }, [markers.length, profiler, spots.length, timeToFirstTileMs]);

  return (
    <View style={styles.container}>
      <MapCanvas
        ref={mapRef}
        camera={camera}
        markers={markers}
        userLocation={follow.userLocation}
        onCameraChanged={handleCameraChanged}
        onMarkerPress={setSelectedId}
        onClusterPress={handleClusterPress}
        onMapPress={() => setSelectedId(null)}
        onFirstTilePainted={handleFirstTilePainted}
      />

      <View style={[styles.hud, { top: insets.top + 8 }]}>
        <Text style={styles.hudTitle}>EPIC-01 Map Spike (MapLibre)</Text>
        <Text style={styles.hudText}>
          Markers: {spots.length} · Visible: {markers.length}
        </Text>
        <Text style={styles.hudText}>
          FPS: {profiler.displayFps} · Frame: {profiler.displayFrameMs}ms
        </Text>
        <Text style={styles.hudText}>
          Follow: {follow.following ? 'on' : 'off'}
          {timeToFirstTileMs !== null ? ` · First tile: ${timeToFirstTileMs}ms` : ''}
          {selectedId ? ` · Selected: ${selectedId}` : ''}
        </Text>
      </View>

      <View style={[styles.controls, { bottom: insets.bottom + 72 }]}>
        {!follow.following ? (
          <Pressable style={styles.button} onPress={follow.recenter} testID="map.follow">
            <Text style={styles.buttonText}>Recentre</Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.button, profiler.isRecording && styles.buttonActive]}
          onPress={profiler.isRecording ? profiler.stopRecording : profiler.startRecording}
          testID="map.profiler.toggle"
        >
          <Text style={styles.buttonText}>
            {profiler.isRecording ? `Stop (${profiler.sampleCount})` : 'Record FPS'}
          </Text>
        </Pressable>

        <Pressable style={styles.button} onPress={handleExportTrace} testID="map.profiler.export">
          <Text style={styles.buttonText}>Export trace</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#e8ede9',
  },
  hud: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(30, 58, 47, 0.88)',
    borderRadius: 12,
    padding: 12,
  },
  hudTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  hudText: {
    color: '#d1e7d6',
    fontSize: 12,
    lineHeight: 18,
  },
  controls: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: '#1e3a2f',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonActive: {
    backgroundColor: '#b45309',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
