import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { createRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DeviceLocation, RenderableMarker } from '@/domain/geo/types';
import {
  MapCanvas,
  type MapCanvasHandle,
  type MapCanvasProps,
} from '@/features/map/components/MapCanvas';

// Layout contract only: the geometric T70/T77 assertion (measured rects, every §8.2 state) needs a
// real layout engine and stays e2e/device. Do not fake it with synthetic onLayout events.

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

// --- WP-07 (SCRUM-28): attribution guaranteed by layout, not z-order (R75/R76, NFR-99) ---

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function parseRgba(value: string): { rgb: [number, number, number]; a: number } {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`unsupported colour ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}

function contrastOver(fg: string, bg: string, backdrop: number): number {
  const { rgb, a } = parseRgba(bg);
  const comp = rgb.map((v) => v * a + backdrop * (1 - a));
  const toHex = (v: number[]) => `#${v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  const l1 = luminance(fg);
  const l2 = luminance(toHex(comp));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('MapCanvas attribution layout (SPEC-008 R75/R76)', () => {
  test('the attribution sits in an in-flow reserved inset, not an overlay (SPEC-008-T77 layout half, R76)', async () => {
    await renderCanvas();
    const inset = screen.getByTestId('map.attribution-inset');
    const inner = within(inset).getByTestId('map.attribution');
    // Whole-style equality: any added absolute positioning or stacking key fails this test.
    expect(StyleSheet.flatten(inset.props.style)).toEqual({
      flexShrink: 0,
      alignItems: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 4,
    });
    expect(Object.keys(StyleSheet.flatten(inner.props.style)).sort()).toEqual([
      'backgroundColor',
      'borderColor',
      'borderRadius',
      'borderWidth',
      'paddingHorizontal',
      'paddingVertical',
    ]);
  });

  test('consumer chrome renders only in the overlay region above the inset (R76)', async () => {
    await render(
      <MapCanvas {...buildProps()}>
        <View testID="chrome.banner" />
      </MapCanvas>,
    );
    const overlay = screen.getByTestId('map.overlay');
    expect(within(overlay).getByTestId('chrome.banner')).toBeOnTheScreen();
    expect(within(screen.getByTestId('map.attribution-inset')).queryByTestId('chrome.banner')).toBeNull();
    const overlayStyle = StyleSheet.flatten(overlay.props.style);
    expect(overlayStyle.flex).toBe(1);
    expect(overlayStyle.overflow).toBe('hidden');
    const order = screen
      .getByTestId('map.chrome')
      .children.filter((c): c is Exclude<typeof c, string> => typeof c !== 'string')
      .filter((c) => typeof c.type === 'string')
      .map((c) => c.props.testID);
    expect(order).toEqual(['map.overlay', 'map.attribution-inset', 'map.reserved-bottom']);
  });

  test.each([0, 120, 400, 2000, -10, Number.NaN])(
    'bottomInset %p reserves space below the notice, which never shrinks (SPEC-008-T70 structural)',
    async (inset) => {
      await renderCanvas({ bottomInset: inset });
      expect(screen.getByTestId('map.attribution')).toBeOnTheScreen();
      const spacer = StyleSheet.flatten(screen.getByTestId('map.reserved-bottom').props.style);
      expect(spacer.height).toBe(Number.isFinite(inset) ? Math.max(0, inset) : 0);
      expect(spacer.flexShrink).toBe(1);
      expect(StyleSheet.flatten(screen.getByTestId('map.attribution-inset').props.style).flexShrink).toBe(0);
    },
  );

  test('the notice is exact, untruncated and scalable, with no tap-to-reveal (SPEC-008-T69, TC-GEO-40 unit half)', async () => {
    await renderCanvas();
    const text = screen.getByText('© OpenStreetMap contributors');
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.ellipsizeMode).toBeUndefined();
    expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    expect(text.props.allowFontScaling).not.toBe(false);
    let node: typeof text.parent = screen.getByTestId('map.attribution');
    while (node) {
      expect(node.props.onPress).toBeUndefined();
      node = node.parent;
    }
  });

  test('text contrast is at least 4.5:1 over the worst-case backdrop (TC-GEO-38 static half)', async () => {
    await renderCanvas();
    const container = StyleSheet.flatten(screen.getByTestId('map.attribution').props.style);
    const label = StyleSheet.flatten(screen.getByText('© OpenStreetMap contributors').props.style);
    for (const backdrop of [0, 255]) {
      expect(contrastOver(label.color as string, container.backgroundColor as string, backdrop)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

