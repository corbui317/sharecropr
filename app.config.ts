import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Sharecropr-controlled tile CDN origin — no API keys, no user identifiers (ADR-0020). */
const TILE_ORIGIN = process.env.TILE_ORIGIN ?? 'https://tiles.staging.sharecropr.com';

/** Immutable dated archive name — never a `latest` alias (Environments §11). */
const BASEMAP_ARCHIVE =
  process.env.BASEMAP_ARCHIVE ?? 'sharecropr-basemap-202608.pmtiles';

export default ({ config }: ConfigContext): ExpoConfig =>
  ({
    ...config,
    name: 'Sharecropr',
    slug: 'sharecropr',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: 'sharecropr',
    newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#1a3d2e',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.sharecropr.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Sharecropr uses your location to show nearby safe meeting spots while you use the map.',
    },
  },
  android: {
    package: 'com.sharecropr.app',
    adaptiveIcon: {
      backgroundColor: '#1a3d2e',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Sharecropr uses your location to show nearby safe meeting spots while you use the map.',
      },
    ],
    '@maplibre/maplibre-react-native',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    tileOrigin: TILE_ORIGIN,
    basemapArchive: BASEMAP_ARCHIVE,
  },
}) as ExpoConfig;
