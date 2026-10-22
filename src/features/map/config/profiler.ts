/**
 * The spike profiler is a measurement tool, not a product feature. On in dev builds; in release
 * builds only when built with EXPO_PUBLIC_MAP_PROFILER=1 (Expo inlines EXPO_PUBLIC_* at bundle time).
 * Profile release builds: dev-mode JS is not representative.
 */
export const MAP_PROFILER_ENABLED: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_MAP_PROFILER === '1';
