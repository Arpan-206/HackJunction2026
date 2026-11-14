import { createContext, useContext } from 'react';
import { THEMES, DEFAULT_THEME, type StageColors } from '../theme/themes';

/**
 * R3F canvases are separate React roots, so the theme does not cross into them. HandCanvas reads the theme outside
 * and provides the stage colours here; everything inside a canvas reads them with useStageColors().
 */
export const StageColorsContext = createContext<StageColors>(THEMES[DEFAULT_THEME].stage);

/** Stage colours for the active theme, usable inside any 3D component. */
export function useStageColors(): StageColors {
  return useContext(StageColorsContext);
}

/**
 * The point on the table a hand is centred on: the ring's centre (x, z). HandCanvas and the still renderer provide it on
 * the hand-only layouts, and <Hand> places itself so that its visual centre lands here (plus its position prop). Null
 * (no provider, or a layout that registers hands to props by the wrist) leaves the hand's origin, the wrist, at position.
 */
export const StageAnchorContext = createContext<readonly [number, number] | null>(null);

export function useStageAnchor(): readonly [number, number] | null {
  return useContext(StageAnchorContext);
}
