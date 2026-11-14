import { CanvasTexture, SRGBColorSpace } from 'three';
import type { StageColors } from '../theme/themes';

/**
 * Codex stage colours: the expert's world is a Leonardo notebook. Iron-gall ink on warm brown paper; the hand is a lit
 * sketch in parchment light. Gold, vermilion and malachite keep their meanings.
 */
export const CODEX_STAGE: StageColors = {
  background: '#E2CDA2',
  grid: '#4B3621',
  gridOpacity: 0.16,
  circle: '#4B3621',
  chalk: '#F2E6CA',
  ink: '#3B2614',
  ghost: '#6B4A28',
  gold: '#C9A24B',
  vermilion: '#B2321B',
  malachite: '#2F7A57',
  shadow: '#3B2614',
  skyLight: '#FFF1D6',
  groundLight: '#8A6B45',
};

/** Small deterministic generator so a page always gets the same sheet. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParchmentOptions {
  width?: number;
  height?: number;
  /** Base paper colour. */
  tone?: string;
  seed?: number;
  /** Darken the edges like an old sheet. */
  vignette?: boolean;
  /** Ruled double border, as on a study plate. */
  border?: boolean;
  /** Faint construction grid in ink. Cell size in pixels, 0 for none. */
  grid?: number;
}

/**
 * Draws brown parchment on a 2D canvas: mottled tone, laid-paper fibres, foxing spots and an optional plate border.
 * Used both as the 3D sheet texture and as the CSS background of the codex pages, so paper and UI match.
 */
export function drawParchment({ width = 1024, height = 1024, tone = '#E2CDA2', seed = 7, vignette = true, border = false, grid = 0 }: ParchmentOptions = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const r = rng(seed);
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, width, height);

  // Mottling: broad soft blotches of lighter and darker paper.
  for (let i = 0; i < 26; i++) {
    const x = r() * width;
    const y = r() * height;
    const rad = (0.08 + r() * 0.22) * Math.max(width, height);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() > 0.5;
    g.addColorStop(0, light ? 'rgba(255,248,228,0.14)' : 'rgba(140,96,48,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // Laid lines: very faint horizontal chain lines of hand-made paper.
  ctx.strokeStyle = 'rgba(90,60,30,0.035)';
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 7 + r() * 2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + (r() - 0.5) * 2);
    ctx.stroke();
  }

  // Fibres: short curved hairs, light and dark.
  const fibres = Math.round((width * height) / 900);
  for (let i = 0; i < fibres; i++) {
    const x = r() * width;
    const y = r() * height;
    const len = 4 + r() * 16;
    const a = r() * Math.PI * 2;
    ctx.strokeStyle = r() > 0.5 ? `rgba(255,248,230,${0.14 + r() * 0.2})` : `rgba(96,64,32,${0.05 + r() * 0.1})`;
    ctx.lineWidth = 0.5 + r() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.6, y + Math.sin(a + 0.6) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // Foxing: small rusty spots, clustered towards the edges.
  for (let i = 0; i < 46; i++) {
    const edge = r() > 0.4;
    const x = edge ? (r() > 0.5 ? r() * width * 0.18 : width - r() * width * 0.18) : r() * width;
    const y = r() * height;
    const rad = 1.5 + r() * (r() > 0.85 ? 12 : 5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(140,86,40,${0.18 + r() * 0.2})`);
    g.addColorStop(1, 'rgba(140,86,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  if (grid > 0) {
    ctx.strokeStyle = 'rgba(75,54,33,0.13)';
    ctx.lineWidth = 1;
    for (let x = grid; x < width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = grid; y < height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  if (vignette) {
    const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(92,60,28,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  if (border) {
    const m = Math.round(width * 0.035);
    ctx.strokeStyle = 'rgba(59,38,20,0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(m, m, width - 2 * m, height - 2 * m);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(m + 9, m + 9, width - 2 * m - 18, height - 2 * m - 18);
  }
  return c;
}

const textureCache = new Map<string, CanvasTexture>();

/** A cached texture of drawParchment for 3D sheets. */
export function getParchmentTexture(opts: ParchmentOptions = {}): CanvasTexture {
  const key = JSON.stringify(opts);
  let t = textureCache.get(key);
  if (!t) {
    t = new CanvasTexture(drawParchment(opts));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    textureCache.set(key, t);
  }
  return t;
}

const urlCache = new Map<string, string>();

/** A cached data URL of drawParchment for CSS backgrounds. */
export function getParchmentUrl(opts: ParchmentOptions = {}): string {
  const key = JSON.stringify(opts);
  let u = urlCache.get(key);
  if (!u) {
    u = drawParchment(opts).toDataURL('image/jpeg', 0.86);
    urlCache.set(key, u);
  }
  return u;
}
