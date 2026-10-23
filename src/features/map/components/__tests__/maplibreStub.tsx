import { jest } from '@jest/globals';
import type { ReactNode } from 'react';

/**
 * Host-View stand-ins for @maplibre/maplibre-react-native, shared by the MapCanvas and screen tests.
 * Each stub forwards its props, so tests read what MapCanvas hands the renderer and fire the
 * renderer's events back at it. The Camera stub exposes `easeTo` through its ref as `__cameraEaseTo`.
 * Not a test file (no `.test.`), so Jest does not collect it.
 */
export function createMaplibreStub() {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const cameraEaseTo = jest.fn();
  const stub = (name: string) =>
    function Stub(props: Record<string, unknown> & { children?: ReactNode }) {
      const id = typeof props.id === 'string' ? `.${props.id}` : '';
      return <View {...props} testID={`maplibre.${name}${id}`} />;
    };
  // React 19: `ref` arrives as an ordinary prop, so no forwardRef is needed.
  function Camera({ ref, ...rest }: Record<string, unknown> & { ref?: React.Ref<unknown> }) {
    React.useImperativeHandle(ref, () => ({ easeTo: cameraEaseTo }));
    return <View {...rest} testID="maplibre.camera" />;
  }
  return {
    Map: stub('map'),
    Camera,
    GeoJSONSource: stub('source'),
    Layer: stub('layer'),
    __cameraEaseTo: cameraEaseTo,
  };
}
