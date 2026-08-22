#!/usr/bin/env bash
# SCR-0106 — Build and publish a launch-metro PMTiles archive (ADR-0020).
# Requires: protomaps CLI, Geofabrik extract, R2 credentials in CI only.
set -euo pipefail

ARCHIVE_DATE="${ARCHIVE_DATE:-$(date +%Y%m)}"
ARCHIVE_NAME="sharecropr-basemap-${ARCHIVE_DATE}.pmtiles"
EXTRACT="${EXTRACT:-data/geofabrik/us-oregon-latest.osm.pbf}"
OUT_DIR="${OUT_DIR:-dist/tiles}"

echo "Building ${ARCHIVE_NAME} from ${EXTRACT}..."
mkdir -p "${OUT_DIR}"

# Tooling version must stay pinned in CI (Environments §11, ADR-0020).
# protomaps build "${EXTRACT}" -o "${OUT_DIR}/${ARCHIVE_NAME}"

echo "Upload to R2: sharecropr-tiles-staging/${ARCHIVE_NAME}"
echo "Then repoint src/features/map/style/sharecropr-basemap.json metadata and app.config.ts BASEMAP_ARCHIVE."
