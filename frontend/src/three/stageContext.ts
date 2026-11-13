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
