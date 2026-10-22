/**
 * Map render milestones, in ms since MapCanvas mount (SPEC-008 R73, SCR-0103).
 * "First painted tile" has no native event; it lies between firstFrame (style painted,
 * tiles possibly not yet) and firstFullFrame (every visible tile rendered).
 * Pure, erasable TypeScript only.
 */

export type RenderMilestone = 'styleLoaded' | 'firstFrame' | 'firstFullFrame' | 'mapFullyRendered';

export type RenderMilestones = Readonly<Record<RenderMilestone, number | null>>;

export const EMPTY_RENDER_MILESTONES: RenderMilestones = {
  styleLoaded: null,
  firstFrame: null,
  firstFullFrame: null,
  mapFullyRendered: null,
};

/** First write wins. Returns the same object when nothing changes. */
export function markMilestone(
  current: RenderMilestones,
  milestone: RenderMilestone,
  msSinceMount: number,
): RenderMilestones {
  if (current[milestone] !== null) return current;
  if (!Number.isFinite(msSinceMount) || msSinceMount < 0) return current;
  return { ...current, [milestone]: Math.round(msSinceMount) };
}

/**
 * A rendered frame counts only once the style has loaded. MapLibre emits exactly one of
 * onDidFinishRenderingFrame / onDidFinishRenderingFrameFully per frame, so a fully-rendered
 * frame also marks firstFrame.
 */
export function markFrameRendered(
  current: RenderMilestones,
  fully: boolean,
  msSinceMount: number,
): RenderMilestones {
  if (current.styleLoaded === null) return current;
  const next = markMilestone(current, 'firstFrame', msSinceMount);
  return fully ? markMilestone(next, 'firstFullFrame', msSinceMount) : next;
}
