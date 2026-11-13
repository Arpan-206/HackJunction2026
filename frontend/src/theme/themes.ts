/** Theme registry: the 3D stage colours for each theme. The CSS tokens live in theme.css under the same ids. */

export type ThemeId = 'bottega' | 'notte' | 'affresco';

/** Colours the 3D scene consumes; everything is a CSS colour string. */
export interface StageColors {
  background: string;
  grid: string;
  gridOpacity: number;
  circle: string;
  chalk: string;
  ink: string;
  ghost: string;
  gold: string;
  vermilion: string;
  malachite: string;
  shadow: string;
  /** Hemisphere light sky and ground colours. */
  skyLight: string;
  groundLight: string;
}

export interface ThemeDef {
  id: ThemeId;
  label: string;
  blurb: string;
  stage: StageColors;
  /** Swatches for the picker: shell, surface, accent. */
  swatches: [string, string, string];
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  bottega: {
    id: 'bottega',
    label: 'Bottega',
    blurb: 'Lapis shell, lime plaster, carta azzurra stage.',
    swatches: ['#1F2E78', '#E8E9E6', '#D9B45A'],
    stage: {
      background: '#8FA0B3',
      grid: '#FFFFFF',
      gridOpacity: 0.16,
      circle: '#FFFFFF',
      chalk: '#EFE9DE',
      ink: '#1A1C26',
      ghost: '#FFFFFF',
      gold: '#D9B45A',
      vermilion: '#B2321B',
      malachite: '#2F7A57',
      shadow: '#141828',
      skyLight: '#FFFFFF',
      groundLight: '#6F7F96',
    },
  },
  notte: {
    id: 'notte',
    label: 'Notte',
    blurb: 'A night hall: deep lapis ground, gilt and chalk.',
    swatches: ['#0B1138', '#18225C', '#E2BE6A'],
    stage: {
      background: '#1A2554',
      grid: '#9FB0E8',
      gridOpacity: 0.2,
      circle: '#E2BE6A',
      chalk: '#F1EBDC',
      ink: '#070A1E',
      ghost: '#F1EBDC',
      gold: '#E2BE6A',
      vermilion: '#E0624A',
      malachite: '#4FB287',
      shadow: '#03050F',
      skyLight: '#B8C4F0',
      groundLight: '#141C4A',
    },
  },
  affresco: {
    id: 'affresco',
    label: 'Affresco',
    blurb: 'Fresco: lime plaster, verdaccio green, sinopia, faded lapis.',
    swatches: ['#4A5A3C', '#E6E5D3', '#9A4F34'],
    stage: {
      background: '#A9B4BC',
      grid: '#F6F4E8',
      gridOpacity: 0.22,
      circle: '#F6F4E8',
      chalk: '#F1EBD8',
      ink: '#2B2A22',
      ghost: '#FFFFFF',
      gold: '#C9A24B',
      vermilion: '#9A4F34',
      malachite: '#4F7A4A',
      shadow: '#2B2A22',
      skyLight: '#FFFDF2',
      groundLight: '#7C8A82',
    },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = 'bottega';
export const THEME_STORAGE_KEY = 'apprentice.theme';
