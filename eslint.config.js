import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

// ---------------------------------------------------------------------------
// Import seams — docs/01-architecture/02-mobile-architecture.md §1, §1.1, §4.1.
//
// ESLint flat config REPLACES a rule's options when a later block matching the
// same file sets the same rule; it never merges them. So every file glob below
// gets exactly ONE complete `no-restricted-imports` entry, assembled from the
// shared pieces here. Never add a second block that sets this rule for a file
// an earlier block already covers without restating the full list — that is the
// SCR-0011 bug. `npm run lint:fixtures` proves each seam still bites.
// ---------------------------------------------------------------------------

/** Map-renderer seam (§4.1, ADR-0019): only MapCanvas.tsx may import a renderer. */
const MAP_RENDERER = {
  group: ['@maplibre/*', 'react-native-maps', 'react-native-maps/*', '@rnmapbox/*'],
  message:
    'The map renderer is isolated behind MapCanvas — exactly one file may import it. ' +
    'See 02-mobile-architecture.md §4.1 and ADR-0019.',
};

/** Transport seam (§1): only src/api/supabase.ts may import the Supabase SDK. */
const SUPABASE_SDK = {
  group: ['@supabase/*'],
  message:
    'Import the client (and its Session/User types) from src/api/supabase.ts. Exactly one file may touch the SDK.',
};

/**
 * Cross-layer imports at any relative depth or via the `@/` alias (tsconfig paths).
 * The §1.1 literal globs ('../features/*') only match one level up, so this regex
 * is what actually holds the layer line for nested files.
 */
const crossLayer = (layers, message) => ({
  regex: `^((\\.\\./)+|@/)(${layers.join('|')})(/|$)`,
  message,
});

const DOMAIN_MESSAGE =
  'src/domain is platform-free pure TypeScript. It must run in Node and in a future web client. ' +
  'If you need a platform capability, invert the dependency: take it as an argument.';

/** src/domain (§1.1, Invariant 11): the §1.1 list verbatim. */
const DOMAIN_PURITY = {
  group: [
    'react', 'react-dom', 'react-native', 'react-native/*', 'react-native-*',
    'expo', 'expo-*', '@expo/*',
    '@supabase/*', '@tanstack/*', 'zustand', '@shopify/*',
    '../features/*', '../app/*', '../api/*', '../ui/*', '../lib/*',
  ],
  message: DOMAIN_MESSAGE,
};
const DOMAIN_LAYERS = crossLayer(['features', 'app', 'api', 'ui', 'lib'], DOMAIN_MESSAGE);

/**
 * src/api (§1, Invariant 11): transport isolation — no React Native, no features/ui.
 *
 * Sanctioned native adapters (recorded in 02-mobile-architecture.md §1 "src/api exceptions"):
 *   react-native-mmkv  — encrypted query cache (§2.3)
 *   expo-secure-store  — chunked session storage + MMKV key (§2.3, §5.2)
 *   expo-crypto        — CSPRNG for the MMKV key (§2.3 "key generated once")
 * Adding to this list is an architecture change: amend §1 in the same PR.
 */
const API_MESSAGE =
  'src/api is transport only: no React Native, no features/ui (Invariant 11, mobile-architecture §1). ' +
  'Only the adapters listed in §1.1a "src/api exceptions" are sanctioned. The AppState listener is the ' +
  'useAuthAutoRefresh boot hook in src/features/auth (SCRUM-62).';
const API_ISOLATION = {
  group: [
    'react-native', 'react-native/*',
    'react-native-*', '!react-native-mmkv',
    'expo', 'expo-*', '!expo-secure-store', '!expo-crypto', '@expo/*',
  ],
  message: API_MESSAGE,
};
const API_LAYERS = crossLayer(['features', 'app', 'ui'], API_MESSAGE);

const restrict = ({ paths = [], patterns }) => ['error', { paths, patterns }];

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

  // 1. Everything: SDK seam + map-renderer seam.
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict({ patterns: [SUPABASE_SDK, MAP_RENDERER] }) },
  },
  // 2. src/domain: purity ban + both seams (DOMAIN_PURITY already covers @supabase/*).
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrict({ patterns: [DOMAIN_PURITY, DOMAIN_LAYERS, SUPABASE_SDK, MAP_RENDERER] }),
      // Already 'error' via tseslint.configs.recommended; restated so §1.1 holds if the preset changes.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // 3. src/api: RN ban + both seams.
  {
    files: ['src/api/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict({ patterns: [API_ISOLATION, API_LAYERS, SUPABASE_SDK, MAP_RENDERER] }) },
  },
  // 4. The SDK seam itself: exempt from SUPABASE_SDK only.
  {
    files: ['src/api/supabase.ts'],
    rules: { 'no-restricted-imports': restrict({ patterns: [API_ISOLATION, API_LAYERS, MAP_RENDERER] }) },
  },
  // 5. The map seam itself: exempt from MAP_RENDERER only.
  {
    files: ['src/features/map/components/MapCanvas.tsx'],
    rules: { 'no-restricted-imports': restrict({ patterns: [SUPABASE_SDK] }) },
  },
  // 6. Jest + RNTL tests (SCRUM-64): RNTL 14's render, fireEvent and userEvent return promises.
  //    An un-awaited one overlaps act() scopes and the next query reads a stale tree.
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'app/**/__tests__/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
);
