import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
    rules: {
      'import/no-unresolved': 'off',
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react-native',
                'react-native/*',
                'react-native-*',
                'expo',
                'expo-*',
                '@expo/*',
                '@maplibre/*',
              ],
              message: 'src/domain is platform-free pure TypeScript.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['src/features/map/components/MapCanvas.tsx'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@maplibre/maplibre-react-native',
              message:
                'MapLibre is isolated behind MapCanvas. See ADR-0019.',
            },
            {
              name: 'react-native-maps',
              message:
                'react-native-maps is superseded. Use MapCanvas (ADR-0019).',
            },
            {
              name: '@rnmapbox/maps',
              message: 'Mapbox is not permitted. Use MapCanvas (ADR-0019).',
            },
          ],
          patterns: [
            {
              group: ['@maplibre/*', 'react-native-maps', 'react-native-maps/*', '@rnmapbox/*'],
              message:
                'The map renderer is isolated behind MapCanvas — exactly one file may import it.',
            },
          ],
        },
      ],
    },
  },
);
