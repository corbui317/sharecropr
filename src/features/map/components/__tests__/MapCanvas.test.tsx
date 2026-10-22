import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { RenderableMarker } from '@/domain/geo/types';
import { MapCanvas, type MapCanvasProps } from '@/features/map/components/MapCanvas';

// The renderer is replaced by host-View stubs so MapCanvas is testable without a map
// (mobile-architecture §4.1). Each stub forwards its props, so tests read what MapCanvas
// hands the renderer and fire the renderer's events back at it.
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  // React 19: `ref` arrives as an ordinary prop, so no forwardRef is needed.
  const stub = (name: string) =>
    function Stub(props: Record<string, unknown> & { children?: React.ReactNode }) {
      const id = typeof props.id === 'string' ? `.${props.id}` : '';
      return <View {...props} testID={`maplibre.${name}${id}`} />;
    };
  return {
    Map: stub('map'),
    Camera: stub('camera'),
    GeoJSONSource: stub('source'),
    Layer: stub('layer'),
  };
});

const camera = { center: { lat: 30.2672, lng: -97.7431 }, zoom: 13 };
const markers: readonly RenderableMarker[] = [];

async function renderCanvas(overrides: Partial<MapCanvasProps> = {}) {
  const props: MapCanvasProps = {
    camera,
    markers,
    userLocation: null,
    onCameraChanged: jest.fn(),
    onMarkerPress: jest.fn(),
    onClusterPress: jest.fn(),
    onMapPress: jest.fn(),
    ...overrides,
  };
  return render(<MapCanvas {...props} />);
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
});
