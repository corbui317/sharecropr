# Spec review: EPIC-00 (Delivery Platform) and EPIC-01 (Map Spike)

Diff `a5bd5e2...HEAD`, 9 commits. Paths are relative to `/home/claude/sharecropr`.

## Story status

| Key | Status | Evidence |
|---|---|---|
| SCR-0001 | Partial | README quick start and `.env.example` exist. Environments §2 says `npm run seed:local`, which is not in `package.json`. README says "Node.js 20+", but `test:auth-domain` uses `--experimental-strip-types` (Node ≥22.6). Nobody has measured the 30-minute target. |
| SCR-0002 | Partial | `.github/workflows/app.yml` runs lint, typecheck and `test:auth-domain` only. There is no branch protection, so "PR is blocked" isn't true yet (CI/CD §2: "there is no CODEOWNERS file or branch protection yet"). |
| SCR-0003/0004/0005 | Not started | There is no `ci:doc-gates` or `ci:spec-traceability`. N-07: "The doc gates themselves still do not exist". |
| SCR-0006 | Not started | No bundle-size or install-size step. |
| SCR-0007 | Partial | `db.yml` runs `supabase db reset` (forward only). Nothing tests rollback, and CI/CD §8 says "There are no `DOWN` migrations". The spec contradicts itself here. |
| SCR-0008 | Not started | `supabase/tests/query_timing.test.sql` is SCR-0212 timing, not committed `EXPLAIN (ANALYZE, BUFFERS)` baselines. |
| SCR-0009 | Not started | No `eas.json` and no build workflow. |
| SCR-0010 | Not started | No audit workflow and no dependabot. |
| SCR-0011 | **Wrong** | See C1. |
| SCR-0012 | Not started | Blocked by SCR-0009. |
| SCR-0105 | Done | `MapCanvas.tsx` is the only `@maplibre/*` import. It uses Camera center+zoom and one `GeoJSONSource` with `cluster={false}`. The lint rule now bans `@maplibre/*`. |
| SCR-0106 | Partial | The style JSON is versioned. In `scripts/tile-build.sh` the `protomaps build` line is commented out and nothing is uploaded. There is no `tile-build.yml`, and no archive, fonts or sprites are on R2. |
| SCR-0101 | Partial | The code exists. It needs physical iOS and Android devices. Style complexity is not exercised (C4). |
| SCR-0102 | Partial / Wrong | Needs a device. Follow mode is broken while panning (C2). |
| SCR-0103 | Partial / Wrong | Needs a reference Android device. The profiler can't produce a trace (C3). |
| SCR-0104 | Not started | `docs/07-review/03-map-spike-go-no-go.md` still has the outcome blank. |
| SCR-0107 | Not started | No T69/T70/T77/T78 tests. `map-attribution` and `map-egress` are "Planned". |

## (a) Missing or partial

Covered in the table above. Two cross-cutting gaps:
- The NFR-99 attribution check is a "licence obligation … CI, blocking", and nothing verifies it. `OsmAttribution` is absolutely positioned (`zIndex: 10`), but R76 says "the layout MUST guarantee this rather than achieve it by luck of z-order."
- The pipeline doesn't record time-to-first-tile (R73) or memory under 250 MB (NFR-09).

## (b) Scope creep and ordering

- **EPIC-02 and EPIC-03 shipped while EPIC-01 is open.** The backlog says "This epic blocks every other epic except EPIC-00, SCR-0801, and EPIC-19" and the goal is to prove the stack "before a line of the data model is written". Migrations 0001–0010 and the whole auth feature landed with no go/no-go.
- **The spike screen now sits behind full auth.** `app/index.tsx` redirects through sign-in and email verification, so on-device profiling needs a working Supabase auth backend.
- Dead code: `getBasemapConfig` in `basemap.ts`, `MapCanvasProps.styleUrl`, and `useFollowMode.requestPermission` are never used.

## (c) Looks done, but wrong

- **C1 – The RN import ban doesn't work.**
  - Invariant 11: "`src/domain` and `src/api` must not import React Native … CI enforces it".
  - In `eslint.config.js`, the later `src/**/*.{ts,tsx}` block sets `no-restricted-imports` again. Flat config replaces rule options, so the `src/domain` ban is overridden.
  - `src/api` has no ban at all.
  - `src/api/supabase.ts` imports `react-native` and is globally ignored. `src/api/query-cache.ts` imports `react-native-mmkv`, `expo-crypto` and `expo-secure-store`.
  - `MapCanvas.tsx` is also globally ignored, so it gets no lint at all, not just an exemption from the `@maplibre/*` ban.
- **C2 – Follow mode during a pan.**
  - R04: "A user pan, pinch, or rotate gesture MUST set `following = false`."
  - `following` is cleared only in `onRegionDidChange`, which fires at the end of the gesture. A location tick in the middle of a pan calls `easeTo` and pulls the camera back while the user is dragging. That is exactly the SCR-0102 scenario ("while the map is panning").
  - The avatar jumps from fix to fix rather than animating.
- **C3 – The profiler records nothing.**
  - `useFpsProfiler.ts` reads `recordingRef.current` and writes `samplesRef.current` inside a Reanimated `useFrameCallback` worklet, which runs on the UI thread. A worklet captures a copy of the ref, so JS-side samples stay empty and the summary is all zeros.
  - Even if fixed, it measures Reanimated UI-thread frames, not MapLibre's GL render thread. `MAX_SAMPLES = 600` keeps only about 10 s, which can't show "sustained" 60 fps.
- **C4 – The spike doesn't test what the AC says is still unproven.**
  - The AC says: "Exercise both explicitly … label collision, sprite count, glyph loading".
  - `sharecropr-basemap.json` has five fill and line layers, no label or POI symbol layers, and no icons that use the sprite.
- **C5 – Time-to-first-tile is mislabelled.** The value comes from `onDidFinishRenderingMapFully` (a full render), but R73 measures the "first painted tile".
- **C6 – Extra feature properties.**
  - R69: properties must be "exactly `(id, listing_count, category, label, selected)`".
  - `markerFeatureCollection.ts` adds `kind`, `category_glyph`, `cluster_id` and `point_count`, so T68 would fail. This needs a spec amendment or a code change; it shouldn't be resolved silently.
