// SPEC-008-T04 · SPEC-008-T05 (unit half) · SPEC-008-T06 (unit half) · R05 · R06 · SCRUM-25
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { INITIAL_FOLLOW_STATE } from '@/features/map/lib/followMode';
import { useFollowModeStore } from '@/features/map/stores/followModeStore';
import { MapSpikeScreen } from '@/features/map/screens/MapSpikeScreen';

jest.mock('@maplibre/maplibre-react-native', () =>
  jest
    .requireActual<typeof import('../../components/__tests__/maplibreStub')>(
      '../../components/__tests__/maplibreStub',
    )
    .createMaplibreStub(),
);

jest.mock('react-native-safe-area-context', () =>
  jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@/features/map/hooks/useFpsProfiler', () => ({
  useFpsProfiler: () => ({
    enabled: false,
    isRecording: false,
    readLive: jest.fn(),
    getReport: jest.fn(),
    recordMapFrame: jest.fn(),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  }),
}));

jest.mock('@/features/map/hooks/useMapMarkers', () => ({
  useMapMarkers: () => [],
  buildClusterIndex: () => ({ getClusterExpansionZoom: () => 14 }),
}));

jest.mock('expo-location', () => {
  const state: { watcher: ((fix: unknown) => void) | null } = { watcher: null };
  return {
    __state: state,
    Accuracy: { Balanced: 3 },
    requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    requestBackgroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 45, longitude: -122 } })),
    watchPositionAsync: jest.fn(async (_opts: unknown, cb: (fix: unknown) => void) => {
      state.watcher = cb;
      return { remove: jest.fn() };
    }),
  };
});

const easeTo = () =>
  jest.requireMock<{ __cameraEaseTo: jest.Mock }>('@maplibre/maplibre-react-native').__cameraEaseTo;
const watcher = () =>
  jest.requireMock<{ __state: { watcher: ((fix: unknown) => void) | null } }>('expo-location').__state;

const willChange = (userInteraction: boolean) => ({
  nativeEvent: { center: [-122.67, 45.51], zoom: 13, userInteraction, animated: false },
});

async function renderBooted() {
  await render(<MapSpikeScreen />);
  await act(async () => {});
  easeTo().mockClear();
}

beforeEach(() => {
  useFollowModeStore.setState(INITIAL_FOLLOW_STATE);
  watcher().watcher = null;
  easeTo().mockClear();
});

describe('MapSpikeScreen follow wiring', () => {
  test('a user regionWillChange shows Recentre and Follow: off before any regionDidChange (SPEC-008-T04, T06 unit, SCRUM-25 AC1)', async () => {
    await renderBooted();
    expect(screen.queryByTestId('map.follow')).toBeNull();

    await fireEvent(screen.getByTestId('maplibre.map'), 'regionWillChange', willChange(true));

    expect(screen.getByTestId('map.follow')).toBeOnTheScreen();
    expect(screen.getByText(/Follow: off/)).toBeOnTheScreen();
  });

  test('a programmatic move leaves Recentre absent (SPEC-008-T05 unit, R05)', async () => {
    await renderBooted();
    const map = screen.getByTestId('maplibre.map');

    await fireEvent(map, 'regionWillChange', willChange(false));
    await fireEvent(map, 'regionDidChange', willChange(false));

    expect(screen.queryByTestId('map.follow')).toBeNull();
  });

  test('a watcher fix during a gesture leaves the camera alone (SCRUM-25 AC2)', async () => {
    await renderBooted();
    await fireEvent(screen.getByTestId('maplibre.map'), 'regionWillChange', willChange(true));

    await act(async () => {
      watcher().watcher?.({ coords: { latitude: 46, longitude: -121 } });
    });

    expect(easeTo()).not.toHaveBeenCalled();
  });

  test('pressing Recentre eases to the last fix in 200 ms and the button disappears (R06)', async () => {
    await renderBooted();
    await fireEvent(screen.getByTestId('maplibre.map'), 'regionWillChange', willChange(true));

    await fireEvent.press(screen.getByTestId('map.follow'));

    expect(easeTo()).toHaveBeenCalledWith({ center: [-122, 45], duration: 200 });
    expect(screen.queryByTestId('map.follow')).toBeNull();
  });
});
