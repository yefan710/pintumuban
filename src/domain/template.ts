import { templatePackageSchema, type CanvasOutput, type CanvasRatio, type PptFrameConfig, type TemplatePackage } from '../schema/template.schema';

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
  };
}

export function batchDuplicateOutput(output: CanvasOutput, startIndex: number, count: number, pageStep: number) {
  return Array.from({ length: count }, (_, index) =>
    duplicateOutput(output, startIndex + index, pageStep * (index + 1)),
  );
}

export function validateTemplate(template: unknown) {
  return templatePackageSchema.safeParse(template);
}
