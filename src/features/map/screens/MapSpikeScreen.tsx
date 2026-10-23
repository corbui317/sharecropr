import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
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
import { MAP_PROFILER_ENABLED } from '@/features/map/config/profiler';
import { useFpsProfiler, type LiveProfilerReading } from '@/features/map/hooks/useFpsProfiler';
import { useFollowMode } from '@/features/map/hooks/useFollowMode';
import { buildClusterIndex, useMapMarkers } from '@/features/map/hooks/useMapMarkers';
import { FOLLOW_ANIMATION_MS } from '@/features/map/lib/followMode';
import { EMPTY_RENDER_MILESTONES, type RenderMilestones } from '@/features/map/lib/renderMilestones';

/** Portland, OR — launch metro one placeholder for spike data. */
const SPIKE_CENTER = { lat: 45.5152, lng: -122.6784 };

const fmtMs = (v: number | null) => (v === null ? '—' : String(v));

function initialCamera(center = SPIKE_CENTER): Camera {
  return { center, zoom: DEFAULT_ZOOM };
}

export function MapSpikeScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapCanvasHandle>(null);
  const [milestones, setMilestones] = useState<RenderMilestones>(EMPTY_RENDER_MILESTONES);

  const spots = useMemo(() => generateSpikeMarkers(SPIKE_CENTER, 200), []);

  const [camera, setCamera] = useState<Camera>(() => initialCamera());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clusterIndex = useMemo(() => buildClusterIndex(spots), [spots]);
  const markers = useMapMarkers(spots, camera, selectedId);

  const profiler = useFpsProfiler({ enabled: MAP_PROFILER_ENABLED });

  const handleAnimateToUser = useCallback((location: DeviceLocation) => {
    mapRef.current?.animateToCoordinate(location, FOLLOW_ANIMATION_MS);
  }, []);

  const follow = useFollowMode({ onAnimateToUser: handleAnimateToUser });
  const { onGestureStart, onGestureEnd } = follow;

  const handleCameraChanged = useCallback(
    (nextCamera: Camera, gesture: boolean) => {
      setCamera(nextCamera);
      if (gesture) {
        onGestureEnd();
      }
    },
    [onGestureEnd],
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

  const handleExportTrace = useCallback(async () => {
    const profile = profiler.getReport();
    const payload = {
      epic: 'EPIC-01',
      story: 'SCR-0103',
      renderer: '@maplibre/maplibre-react-native',
      timestamp: new Date().toISOString(),
      platform: Platform.OS,
      osVersion: Platform.Version,
      devBuild: __DEV__,
      markerCount: spots.length,
      visibleFeatures: markers.length,
      renderMilestonesMsSinceCanvasMount: milestones,
      profile,
      note: 'Attach device model. Profile a release build (EXPO_PUBLIC_MAP_PROFILER=1). Primary evidence is the Perfetto/Instruments trace.',
    };

    try {
      await Share.share({
        message: JSON.stringify(payload, null, 2),
        title: 'Map spike FPS trace',
      });
    } catch {
      Alert.alert('Trace ready', JSON.stringify(profile.channels.ui.summary, null, 2));
    }
  }, [markers.length, milestones, profiler, spots.length]);

  return (
    <View style={styles.container}>
      <MapCanvas
        ref={mapRef}
        camera={camera}
        markers={markers}
        userLocation={follow.userLocation}
        onCameraChanged={handleCameraChanged}
        onGestureStart={onGestureStart}
        onMarkerPress={setSelectedId}
        onClusterPress={handleClusterPress}
        onMapPress={() => setSelectedId(null)}
        onRenderMilestones={setMilestones}
        onMapFrameRendered={MAP_PROFILER_ENABLED ? profiler.recordMapFrame : undefined}
      >
        <View style={[styles.hud, { top: insets.top + 8 }]} testID="map.hud">
          <Text style={styles.hudTitle}>EPIC-01 Map Spike (MapLibre)</Text>
          <Text style={styles.hudText}>
            Markers: {spots.length} · Visible: {markers.length}
          </Text>
          {profiler.enabled ? <ProfilerReadout readLive={profiler.readLive} /> : null}
          <Text style={styles.hudText}>
            Follow: {follow.following ? 'on' : 'off'}
            {selectedId ? ` · Selected: ${selectedId}` : ''}
          </Text>
          <Text style={styles.hudText}>
            Render ms from canvas mount: style {fmtMs(milestones.styleLoaded)} · first frame{' '}
            {fmtMs(milestones.firstFrame)} · all tiles {fmtMs(milestones.firstFullFrame)}
          </Text>
        </View>

        <View style={[styles.controls, { bottom: insets.bottom + 72 }]} testID="map.controls">
          {!follow.following ? (
            <Pressable style={styles.button} onPress={follow.recenter} testID="map.follow">
              <Text style={styles.buttonText}>Recentre</Text>
            </Pressable>
          ) : null}

          {profiler.enabled ? (
            <>
              <Pressable
                style={[styles.button, profiler.isRecording && styles.buttonActive]}
                onPress={profiler.isRecording ? profiler.stopRecording : profiler.startRecording}
                testID="map.profiler.toggle"
              >
                <Text style={styles.buttonText}>
                  {profiler.isRecording ? 'Stop recording' : 'Record frames'}
                </Text>
              </Pressable>

              <Pressable style={styles.button} onPress={handleExportTrace} testID="map.profiler.export">
                <Text style={styles.buttonText}>Export trace</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </MapCanvas>
    </View>
  );
}

function ProfilerReadout({ readLive }: { readLive: () => LiveProfilerReading }) {
  const [live, setLive] = useState<LiveProfilerReading>(() => readLive());
  useEffect(() => {
    const id = setInterval(() => setLive(readLive()), 250);
    return () => clearInterval(id);
  }, [readLive]);
  return (
    <Text style={styles.hudText}>
      UI thread ~{live.uiFps} fps ({live.uiFrameMs} ms) · samples ui {live.samples.ui} / js{' '}
      {live.samples.js} / map {live.samples.map}
    </Text>
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
