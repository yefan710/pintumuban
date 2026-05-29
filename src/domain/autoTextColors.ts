import type { TextBlockConfig } from '../schema/template.schema';

export interface PixelSample {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface TextBlockColorOptions {
  boxHeight?: number;
  expandRatio?: number;
}

export interface ResolvedTextBlockColors {
  backgroundColor: string;
  textColor: string;
  usedAutoAccent: boolean;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Candidate extends Rgb {
  weight: number;
}

const DEFAULT_EXPAND_RATIO = 0.15;

export function resolveTextBlockColors(
  block: TextBlockConfig,
  sample?: PixelSample | null,
  options: TextBlockColorOptions = {},
): ResolvedTextBlockColors {
  const fallback = {
    backgroundColor: block.backgroundColor,
    textColor: block.textColor,
    usedAutoAccent: false,
  };

  if (block.colorMode !== 'autoAccent' || !sample) {
    return fallback;
  }

  const boxHeight = Math.max(1, options.boxHeight ?? estimateTextBlockHeight(block));
  const rect = expandAndClampRect(
    block.x,
    block.y,
    block.w,
    boxHeight,
    sample.width,
    sample.height,
    options.expandRatio ?? DEFAULT_EXPAND_RATIO,
  );
  const accent = pickAccentColor(sample, rect);
  if (!accent) {
    return fallback;
  }

  const backgroundColor = rgbToHex(accent);
  const textColor = pickReadableTextColor(accent);
  const ratio = contrastRatio(accent, hexToRgb(textColor));
  const target = block.fontSize >= 24 ? 3 : 4.5;
  if (ratio < target) {
    return fallback;
  }

  return {
    backgroundColor,
    textColor,
    usedAutoAccent: true,
  };
}

export function estimateTextBlockHeight(block: TextBlockConfig) {
  const lineHeight = block.fontSize * 1.16;
  const estimatedLines = Math.max(1, Math.ceil(block.text.length / Math.max(1, Math.floor(block.w / (block.fontSize * 0.9)))));
  return Math.round(block.padding * 2 + estimatedLines * lineHeight);
}

function expandAndClampRect(x: number, y: number, w: number, h: number, canvasW: number, canvasH: number, expandRatio: number) {
  const dx = w * expandRatio;
  const dy = h * expandRatio;
  const left = Math.max(0, Math.floor(x - dx));
  const top = Math.max(0, Math.floor(y - dy));
  const right = Math.min(canvasW, Math.ceil(x + w + dx));
  const bottom = Math.min(canvasH, Math.ceil(y + h + dy));
  return { left, top, right, bottom };
}

function pickAccentColor(sample: PixelSample, rect: { left: number; top: number; right: number; bottom: number }): Rgb | null {
  const bins = new Map<string, Candidate>();
  const strideX = Math.max(1, Math.floor((rect.right - rect.left) / 160));
  const strideY = Math.max(1, Math.floor((rect.bottom - rect.top) / 160));

  for (let y = rect.top; y < rect.bottom; y += strideY) {
    for (let x = rect.left; x < rect.right; x += strideX) {
      const offset = (y * sample.width + x) * 4;
      const alpha = sample.data[offset + 3] ?? 255;
      if (alpha < 32) {
        continue;
      }
      const rgb = {
        r: sample.data[offset] ?? 0,
        g: sample.data[offset + 1] ?? 0,
        b: sample.data[offset + 2] ?? 0,
      };
      const hsl = rgbToHsl(rgb);
      const lum = relativeLuminance(rgb);
      if (lum > 0.93 || lum < 0.06 || hsl.s < 0.18) {
        continue;
      }

      const hueBin = Math.floor(hsl.h / 18);
      const satBin = Math.floor(hsl.s * 4);
      const lightBin = Math.floor(hsl.l * 4);
      const key = `${hueBin}:${satBin}:${lightBin}`;
      const weight = hsl.s * 1.8 + (1 - Math.abs(hsl.l - 0.46)) + (1 - Math.abs(lum - 0.34));
      const current = bins.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
      current.r += rgb.r * weight;
      current.g += rgb.g * weight;
      current.b += rgb.b * weight;
      current.weight += weight;
      bins.set(key, current);
    }
  }

  let best: Candidate | null = null;
  for (const candidate of bins.values()) {
    if (!best || candidate.weight > best.weight) {
      best = candidate;
    }
  }
  if (!best || best.weight <= 0) {
    return null;
  }
  return {
    r: clampChannel(best.r / best.weight),
    g: clampChannel(best.g / best.weight),
    b: clampChannel(best.b / best.weight),
  };
}

function pickReadableTextColor(background: Rgb) {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  return contrastRatio(background, white) >= contrastRatio(background, black) ? '#ffffff' : '#000000';
}

function contrastRatio(a: Rgb, b: Rgb) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance({ r, g, b }: Rgb) {
  const [rs, gs, bs] = [r, g, b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function rgbToHsl({ r, g, b }: Rgb) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const h = max === rn
    ? (gn - bn) / delta + (gn < bn ? 6 : 0)
    : max === gn
      ? (bn - rn) / delta + 2
      : (rn - gn) / delta + 4;
  return { h: h * 60, s, l };
}

function hexToRgb(value: string): Rgb {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value: number) {
  return clampChannel(value).toString(16).padStart(2, '0');
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
