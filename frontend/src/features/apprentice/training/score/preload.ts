/**
 * Starts fetching the lazy 3D score early (the training room calls it on mount), so the scene is ready when a rep ends
 * instead of loading in front of the learner. The module loader caches it, so ScoreView's lazy import reuses this fetch.
 */
export function preloadScoreScene(): void {
  void import('./ScoreScene').catch(() => undefined);
}
