export interface Point {
  x: number;
  y: number;
}

export interface QuadCorners {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

interface CanvasLikeContext {
  canvas: { width: number; height: number };
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  clip(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
}

type Triangle = [Point, Point, Point];

export function rectToCorners(x: number, y: number, w: number, h: number): QuadCorners {
  return {
    topLeft: { x, y },
    topRight: { x: x + w, y },
    bottomRight: { x: x + w, y: y + h },
    bottomLeft: { x, y: y + h },
  };
}

export function getCornersBounds(corners: QuadCorners) {
  const points = Object.values(corners);
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.max(1, Math.round(maxX - minX)),
    h: Math.max(1, Math.round(maxY - minY)),
  };
}

export function translateCorners(corners: QuadCorners, dx: number, dy: number): QuadCorners {
  return {
    topLeft: { x: corners.topLeft.x + dx, y: corners.topLeft.y + dy },
    topRight: { x: corners.topRight.x + dx, y: corners.topRight.y + dy },
    bottomRight: { x: corners.bottomRight.x + dx, y: corners.bottomRight.y + dy },
    bottomLeft: { x: corners.bottomLeft.x + dx, y: corners.bottomLeft.y + dy },
  };
}

export function lockRectFromCorners(corners: QuadCorners, ratio: number) {
  const bounds = getCornersBounds(corners);
  const width = Math.max(120, bounds.w);
  return {
    x: bounds.x,
    y: bounds.y,
    w: width,
    h: Math.round(width / ratio),
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function pointInQuad(corners: QuadCorners, u: number, v: number): Point {
  const top = lerp(corners.topLeft, corners.topRight, u);
  const bottom = lerp(corners.bottomLeft, corners.bottomRight, u);
  return lerp(top, bottom, v);
}

function transformTriangle(ctx: CanvasLikeContext, source: Triangle, destination: Triangle) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(det) < 0.00001) {
    return;
  }

  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / det;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / det;
  const e =
    (d0.x * (s1.x * s2.y - s2.x * s1.y) +
      d1.x * (s2.x * s0.y - s0.x * s2.y) +
      d2.x * (s0.x * s1.y - s1.x * s0.y)) /
    det;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / det;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / det;
  const f =
    (d0.y * (s1.x * s2.y - s2.x * s1.y) +
      d1.y * (s2.x * s0.y - s0.x * s2.y) +
      d2.y * (s0.x * s1.y - s1.x * s0.y)) /
    det;

  ctx.transform(a, b, c, d, e, f);
}

function drawTriangle(
  ctx: CanvasLikeContext,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  source: Triangle,
  destination: Triangle,
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(destination[0].x, destination[0].y);
  ctx.lineTo(destination[1].x, destination[1].y);
  ctx.lineTo(destination[2].x, destination[2].y);
  ctx.closePath();
  ctx.clip();
  transformTriangle(ctx, source, destination);
  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();
}

export function drawImageInQuad(
  ctx: CanvasLikeContext,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  corners: QuadCorners,
  options: {
    opacity?: number;
    blendMode?: GlobalCompositeOperation;
    subdivisions?: number;
  } = {},
) {
  const subdivisions = Math.max(2, Math.round(options.subdivisions ?? 20));
  ctx.save();
  ctx.globalAlpha = options.opacity ?? 1;
  ctx.globalCompositeOperation = options.blendMode ?? 'source-over';

  for (let y = 0; y < subdivisions; y += 1) {
    for (let x = 0; x < subdivisions; x += 1) {
      const u0 = x / subdivisions;
      const v0 = y / subdivisions;
      const u1 = (x + 1) / subdivisions;
      const v1 = (y + 1) / subdivisions;

      const sTopLeft = { x: u0 * sourceWidth, y: v0 * sourceHeight };
      const sTopRight = { x: u1 * sourceWidth, y: v0 * sourceHeight };
      const sBottomRight = { x: u1 * sourceWidth, y: v1 * sourceHeight };
      const sBottomLeft = { x: u0 * sourceWidth, y: v1 * sourceHeight };

      const dTopLeft = pointInQuad(corners, u0, v0);
      const dTopRight = pointInQuad(corners, u1, v0);
      const dBottomRight = pointInQuad(corners, u1, v1);
      const dBottomLeft = pointInQuad(corners, u0, v1);

      drawTriangle(ctx, image, sourceWidth, sourceHeight, [sTopLeft, sTopRight, sBottomRight], [dTopLeft, dTopRight, dBottomRight]);
      drawTriangle(ctx, image, sourceWidth, sourceHeight, [sTopLeft, sBottomRight, sBottomLeft], [dTopLeft, dBottomRight, dBottomLeft]);
    }
  }

  ctx.restore();
}
