/** Theme registry: the 3D stage colours for each theme. The CSS tokens live in theme.css under the same ids. */

export type ThemeId = 'bottega' | 'notte' | 'affresco';

/** Colours the 3D scene consumes; everything is a CSS colour string. */
export interface StageColors {
  /** The page around the study sheet: the canvas clear colour and the desk the sheet lies on. */
  background: string;
  /** The study sheet under the hands (parchment), drawn with the ink grid and a double ruled border. */
  paper: string;
  /** How much the sheet darkens towards its edges, 0..1: a little by day, a pool of candlelight at night. */
  paperFalloff: number;
  grid: string;
  gridOpacity: number;
  circle: string;
  /** Line colour of drawn cues on the paper: the propless sketches, strings, trails and key letters (ink, not chalk). */
  chalk: string;
  /** Marionette strings: they rise off the sheet into the page, so they need to read on the page tone. */
  thread: string;
  /** Fill of the expert's drawn hand (the white hand with the inked outline). */
  hand: string;
  /** Hand outlines and fine line work: warm iron-gall ink, never pure black. */
  ink: string;
  /** Ink of the hatched cast shadows on the paper, and the stroke opacity. */
  hatch: string;
  hatchOpacity: number;
  ghost: string;
  gold: string;
  vermilion: string;
  malachite: string;
  shadow: string;
  /** Hemisphere light sky and ground colours. */
  skyLight: string;
  groundLight: string;
  /** Colour of the key light that casts the hatched shadows. */
  keyLight: string;
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
    blurb: 'The day sketchbook: parchment, sepia iron-gall ink, a ruled grid.',
    swatches: ['#24170C', '#EADBBD', '#5A3315'],
    stage: {
      background: '#E0CCA6',
      paper: '#EFE0C0',
      paperFalloff: 0.18,
      grid: '#5A3A1E',
      gridOpacity: 0.09,
      circle: '#4A2E18',
      chalk: '#7A5A3C',
      thread: '#5A3A1E',
      hand: '#EFE9DE',
      ink: '#2B1B0F',
      hatch: '#3D2614',
      hatchOpacity: 0.42,
      ghost: '#6B4A28',
      gold: '#C9962E',
      vermilion: '#B2321B',
      malachite: '#2F7A57',
      shadow: '#2B1B0F',
      skyLight: '#FFFFFF',
      groundLight: '#8A7150',
      keyLight: '#FFFFFF',
    },
  },
  notte: {
    id: 'notte',
    label: 'Notte',
    blurb: 'The same sketchbook by candlelight: warm dark, ink still legible.',
    swatches: ['#0E0905', '#221811', '#F0DFC0'],
    stage: {
      background: '#1E150D',
      paper: '#C9A877',
      paperFalloff: 0.62,
      grid: '#2A190C',
      gridOpacity: 0.12,
      circle: '#2A190C',
      chalk: '#2A190C',
      thread: '#E6D3AE',
      hand: '#F1EBDC',
      ink: '#22140A',
      hatch: '#24150A',
      hatchOpacity: 0.5,
      ghost: '#F2E5C9',
      gold: '#E2BE6A',
      vermilion: '#E0624A',
      malachite: '#4FB287',
      shadow: '#120B05',
      skyLight: '#FFF0DA',
      groundLight: '#3A2614',
      keyLight: '#FFEAD0',
    },
  },
  affresco: {
    id: 'affresco',
    label: 'Affresco',
    blurb: 'Sand plaster and a deep burnt orange spine, terracotta and sage in support.',
    swatches: ['#7A4116', '#EDE1CA', '#CA7850'],
    stage: {
      background: '#DCC4A0',
      paper: '#EEDFC2',
      paperFalloff: 0.2,
      grid: '#8A4A1C',
      gridOpacity: 0.09,
      circle: '#6A4024',
      chalk: '#865A3C',
      thread: '#6A3A1C',
      hand: '#F1EBD8',
      ink: '#2E1B10',
      hatch: '#4A2A16',
      hatchOpacity: 0.4,
      ghost: '#6E4A2C',
      gold: '#C9A24B',
      vermilion: '#B81E24',
      malachite: '#2F7A4E',
      shadow: '#2E1B10',
      skyLight: '#FFFDF2',
      groundLight: '#8C7458',
      keyLight: '#FFFFFF',
    },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = 'bottega';
export const THEME_STORAGE_KEY = 'apprentice.theme';
