import { templatePackageSchema, type CanvasOutput, type CanvasRatio, type PptFrameConfig, type TemplatePackage, type TextBlockConfig } from '../schema/template.schema';
import { getCornersBounds, lockRectFromCorners, rectToCorners, translateCorners } from '../renderer/perspective';
import type { QuadCorners } from '../renderer/perspective';

export const MAX_OUTPUTS = 18;
export const PPT_RATIO = 16 / 9;
const DEFAULT_FRAME_X = 90;
const DEFAULT_FRAME_Y = 120;
const DEFAULT_FRAME_W = 720;
const FRAME_MARGIN = 24;
const STACK_GAP = 40;
const CASCADE_STEP = 32;

export function getCanvasSize(ratio: CanvasRatio) {
  switch (ratio) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '3:4':
      return { width: 1080, height: 1440 };
    case '1:1':
      return { width: 1080, height: 1080 };
  }
}

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCanvasOutput(index = 1, ratio: CanvasRatio = '3:4'): CanvasOutput {
  return {
    index,
    name: `图 ${index}`,
    canvas: {
      ratio,
      ...getCanvasSize(ratio),
    },
    background: {
      type: 'color',
      color: '#f3efe7',
    },
    frames: [],
    textBlocks: [],
  };
}

export function createTemplateGroup(): TemplatePackage {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    name: 'ppt-social-template',
    source: {
      type: 'ppt',
      defaultRatio: '16:9',
    },
    maxOutputs: MAX_OUTPUTS,
    outputs: [createCanvasOutput()],
    assets: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy: 'template-studio',
    },
  };
}

export function createFrame(page: number, x = 90, y = 120, w = 720): PptFrameConfig {
  return {
    id: makeId('frame'),
    type: 'ppt_page',
    page,
    x,
    y,
    w,
    h: Math.round(w / PPT_RATIO),
    sourceRatio: '16:9',
    transformMode: 'locked',
    fit: 'contain',
    opacity: 1,
    feather: 0,
    blendMode: 'normal',
    radius: 18,
    shadow: {
      enabled: true,
      x: 0,
      y: 12,
      blur: 28,
      color: '#000000',
      opacity: 0.16,
    },
    border: {
      enabled: false,
      width: 0,
      color: '#ffffff',
      opacity: 1,
    },
  };
}

export function addFrameToOutput(output: CanvasOutput) {
  const frame = createFrame(output.frames.length + 1, ...getNextFramePlacement(output));
  return {
    frame,
    output: {
      ...output,
      frames: [...output.frames, frame],
    },
  };
}

export function createTextBlock(x = 90, y = 84, w = 900): TextBlockConfig {
  return {
    id: makeId('text'),
    type: 'fixed_text',
    text: '把课堂讲到心里',
    x,
    y,
    w,
    fontSize: 64,
    fontFamily: 'PingFang SC, Noto Sans SC, Source Han Sans SC, Microsoft YaHei, sans-serif',
    fontWeight: '900',
    colorMode: 'autoAccent',
    textColor: '#ffffff',
    backgroundColor: '#0b4f71',
    backgroundOpacity: 0.82,
    padding: 28,
    radius: 24,
    opacity: 1,
  };
}

export function unlockFramePerspective(frame: PptFrameConfig): PptFrameConfig {
  const corners = frame.corners ?? rectToCorners(frame.x, frame.y, frame.w, frame.h);
  const bounds = getCornersBounds(corners);
  return {
    ...frame,
    ...bounds,
    transformMode: 'perspective',
    corners,
  };
}

export function lockFrameRatio(frame: PptFrameConfig): PptFrameConfig {
  const rect = lockRectFromCorners(frame.corners ?? rectToCorners(frame.x, frame.y, frame.w, frame.h), PPT_RATIO);
  return {
    ...frame,
    ...rect,
    h: Math.round(rect.w / PPT_RATIO),
    transformMode: 'locked',
    corners: undefined,
  };
}

export function movePerspectiveFrame(frame: PptFrameConfig, x: number, y: number): PptFrameConfig {
  const corners = frame.corners ?? rectToCorners(frame.x, frame.y, frame.w, frame.h);
  const dx = x - frame.x;
  const dy = y - frame.y;
  return syncFrameBounds({
    ...frame,
    corners: translateCorners(corners, dx, dy),
  });
}

export function updatePerspectiveCorner(frame: PptFrameConfig, key: keyof QuadCorners, point: { x: number; y: number }): PptFrameConfig {
  const corners = frame.corners ?? rectToCorners(frame.x, frame.y, frame.w, frame.h);
  return syncFrameBounds({
    ...frame,
    transformMode: 'perspective',
    corners: {
      ...corners,
      [key]: point,
    },
  });
}

function syncFrameBounds(frame: PptFrameConfig): PptFrameConfig {
  if (frame.transformMode !== 'perspective' || !frame.corners) {
    return frame;
  }
  return {
    ...frame,
    ...getCornersBounds(frame.corners),
  };
}

export function addTextBlockToOutput(output: CanvasOutput) {
  const textBlock = createTextBlock();
  return {
    textBlock,
    output: {
      ...output,
      textBlocks: [...(output.textBlocks ?? []), textBlock],
    },
  };
}

export function getNextFramePlacement(output: CanvasOutput): [x: number, y: number, w: number] {
  const width = Math.min(DEFAULT_FRAME_W, output.canvas.width - DEFAULT_FRAME_X * 2);
  const height = Math.round(width / PPT_RATIO);
  const stackedY = DEFAULT_FRAME_Y + output.frames.length * (height + STACK_GAP);
  const maxY = output.canvas.height - height - FRAME_MARGIN;

  if (stackedY <= maxY) {
    return [DEFAULT_FRAME_X, stackedY, width];
  }

  const cascadeIndex = output.frames.length % 8;
  const maxX = output.canvas.width - width - FRAME_MARGIN;
  const x = Math.min(DEFAULT_FRAME_X + cascadeIndex * CASCADE_STEP, maxX);
  const y = Math.min(DEFAULT_FRAME_Y + cascadeIndex * CASCADE_STEP, maxY);
  return [Math.max(FRAME_MARGIN, x), Math.max(FRAME_MARGIN, y), width];
}

export function duplicateOutput(output: CanvasOutput, index: number, pageOffset: number): CanvasOutput {
  return {
    ...output,
    index,
    name: `图 ${index}`,
    frames: output.frames.map((frame) => ({
      ...frame,
      id: makeId('frame'),
      page: Math.max(1, frame.page + pageOffset),
    })),
    textBlocks: (output.textBlocks ?? []).map((textBlock) => ({
      ...textBlock,
      id: makeId('text'),
    })),
  };
}

export function inferBatchPageStep(output: CanvasOutput) {
  if (output.frames.length === 0) {
    return 1;
  }
  const pages = output.frames.map((frame) => frame.page);
  return Math.max(1, Math.max(...pages) - Math.min(...pages) + 1);
}

export function batchDuplicateOutput(output: CanvasOutput, startIndex: number, count: number, pageStep: number) {
  return Array.from({ length: count }, (_, index) =>
    duplicateOutput(output, startIndex + index, pageStep * (index + 1)),
  );
}

export function validateTemplate(template: unknown) {
  return templatePackageSchema.safeParse(template);
}
