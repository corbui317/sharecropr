import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';

import type { DeviceLocation, RenderableMarker } from '@/domain/geo/types';
import {
  MapCanvas,
  type MapCanvasHandle,
  type MapCanvasProps,
} from '@/features/map/components/MapCanvas';

// The renderer is replaced by host-View stubs so MapCanvas is testable without a map
// (mobile-architecture §4.1). Shared with the screen test via ./maplibreStub.
jest.mock('@maplibre/maplibre-react-native', () =>
  jest.requireActual<typeof import('./maplibreStub')>('./maplibreStub').createMaplibreStub(),
);

const easeTo = () =>
  jest.requireMock<{ __cameraEaseTo: jest.Mock }>('@maplibre/maplibre-react-native').__cameraEaseTo;

const camera = { center: { lat: 30.2672, lng: -97.7431 }, zoom: 13 };
const markers: readonly RenderableMarker[] = [];

const A: DeviceLocation = { latitude: 45, longitude: -122 };
const B: DeviceLocation = { latitude: 46, longitude: -121 };

type Frame = { id: number; cb: (ts: number) => void };
let frames: Frame[] = [];
let nextId = 1;

// Manual rAF queue (RN's preset rAF is a zero-delay timer; fake timers would spin on it).
async function frame(ts: number) {
  const due = frames;
  frames = [];
  await act(async () => {
    due.forEach((f) => f.cb(ts));
  });
}

beforeEach(() => {
  frames = [];
  nextId = 1;
  easeTo().mockClear();
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.push({ id, cb });
    return id;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    frames = frames.filter((f) => f.id !== id);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function buildProps(overrides: Partial<MapCanvasProps> = {}): MapCanvasProps {
  return {
    camera,
    markers,
    userLocation: null,
    onCameraChanged: jest.fn(),
    onGestureStart: jest.fn(),
    onMarkerPress: jest.fn(),
    onClusterPress: jest.fn(),
    onMapPress: jest.fn(),
    ...overrides,
  };
}

async function renderCanvas(overrides: Partial<MapCanvasProps> = {}, ref?: React.Ref<MapCanvasHandle>) {
  return render(<MapCanvas ref={ref} {...buildProps(overrides)} />);
}

describe('MapCanvas (renderer stubbed)', () => {
  test('normalises a gesture camera change to gesture=true and a programmatic one to false (SPEC-008-T04)', async () => {
    const onCameraChanged = jest.fn();
    await renderCanvas({ onCameraChanged });
    const map = screen.getByTestId('maplibre.map');

    await fireEvent(map, 'regionDidChange', {
      nativeEvent: { center: [-97.75, 30.27], zoom: 14, userInteraction: true },
    });
    await fireEvent(map, 'regionDidChange', {
      nativeEvent: { center: [-97.74, 30.26], zoom: 12, userInteraction: false },
    });

    expect(onCameraChanged).toHaveBeenNthCalledWith(1, { center: { lng: -97.75, lat: 30.27 }, zoom: 14 }, true);
    expect(onCameraChanged).toHaveBeenNthCalledWith(2, { center: { lng: -97.74, lat: 30.26 }, zoom: 12 }, false);
  });

  test('spot source is configured with renderer clustering off (SPEC-008-T68)', async () => {
    await renderCanvas();
    expect(screen.getByTestId('maplibre.source.spots').props.cluster).toBe(false);
  });

  test('mounts the OSM attribution itself, with no consumer opt-in (SPEC-008-T69)', async () => {
    await renderCanvas();
    expect(screen.getByTestId('map.attribution')).toBeOnTheScreen();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeOnTheScreen();
  });

  test('a user-interaction regionWillChange calls onGestureStart once and not onCameraChanged (SPEC-008-T04, R04)', async () => {
    const onGestureStart = jest.fn();
    const onCameraChanged = jest.fn();
    await renderCanvas({ onGestureStart, onCameraChanged });

    await fireEvent(screen.getByTestId('maplibre.map'), 'regionWillChange', {
      nativeEvent: { center: [-97.75, 30.27], zoom: 14, userInteraction: true, animated: false },
    });

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onCameraChanged).not.toHaveBeenCalled();
  });

  test('a programmatic regionWillChange never calls onGestureStart (SPEC-008-T04, R05)', async () => {
    // Under MapLibre the iOS reason mask (MLRNMapView.m:750) and the Android move reason
    // (MLRNMapView.kt:477-490) are both normalised natively into this one boolean, so T04's
    // per-platform parameterisation collapses to this single flag.
    const onGestureStart = jest.fn();
    await renderCanvas({ onGestureStart });

    await fireEvent(screen.getByTestId('maplibre.map'), 'regionWillChange', {
      nativeEvent: { center: [-97.75, 30.27], zoom: 14, userInteraction: false, animated: true },
    });

    expect(onGestureStart).not.toHaveBeenCalled();
  });

  test('a userLocation prop never moves the camera (SPEC-008-T07)', async () => {
    const { rerender } = await renderCanvas();
    const before = screen.getByTestId('maplibre.camera').props.initialViewState;

    await rerender(<MapCanvas {...buildProps({ userLocation: A })} />);

    expect(easeTo()).not.toHaveBeenCalled();
    expect(screen.getByTestId('maplibre.camera').props.initialViewState).toEqual(before);
  });

  test('the avatar eases A -> midpoint -> B over 200 ms in a single avatar source (R02)', async () => {
    const props = buildProps({ userLocation: A });
    const { rerender } = await render(<MapCanvas {...props} />);
    const coords = () =>
      screen.getByTestId('maplibre.source.avatar').props.data.features[0].geometry.coordinates;
    expect(coords()).toEqual([-122, 45]);

    await rerender(<MapCanvas {...props} userLocation={B} />);
    await frame(1000);
    expect(coords()).toEqual([-122, 45]);
    await frame(1100);
    expect(coords()[0]).toBeCloseTo(-121.5, 10);
    expect(coords()[1]).toBeCloseTo(45.5, 10);
    await frame(1200);
    expect(coords()).toEqual([-121, 46]);
    expect(screen.getAllByTestId('maplibre.source.avatar')).toHaveLength(1);
  });

  test('animateToCoordinate eases to the point with no zoom key so zoom is preserved (R06)', async () => {
    const ref = createRef<MapCanvasHandle>();
    await renderCanvas({}, ref);

    ref.current?.animateToCoordinate(A, 200);

    expect(easeTo()).toHaveBeenCalledWith({ center: [-122, 45], duration: 200 });
    expect(easeTo().mock.calls[0]?.[0]).not.toHaveProperty('zoom');
  });
});
