import type { FitMode } from '../schema/template.schema';

export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fitRect(sourceWidth: number, sourceHeight: number, target: RectLike, fit: FitMode): RectLike {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = target.w / target.h;
  const scale =
    fit === 'cover'
      ? sourceRatio > targetRatio
        ? target.h / sourceHeight
        : target.w / sourceWidth
      : sourceRatio > targetRatio
        ? target.w / sourceWidth
        : target.h / sourceHeight;
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return {
    x: target.x + (target.w - w) / 2,
    y: target.y + (target.h - h) / 2,
    w,
    h,
  };
}
