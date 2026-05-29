import { z } from 'zod';

const assetPathSchema = z
  .string()
  .startsWith('assets/', 'asset paths must start with assets/')
  .refine((path) => !path.startsWith('/') && !path.includes('..'), 'asset paths must be relative and safe');

export const canvasRatioSchema = z.enum(['9:16', '3:4', '1:1']);
export const fitModeSchema = z.enum(['contain', 'cover']);
export const blendModeSchema = z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light']);
export const sourceRatioSchema = z.enum(['16:9', '4:3', 'custom']);
export const frameTransformModeSchema = z.enum(['locked', 'perspective']);
export const textColorModeSchema = z.enum(['fixed', 'autoAccent']);

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const quadCornersSchema = z.object({
  topLeft: pointSchema,
  topRight: pointSchema,
  bottomRight: pointSchema,
  bottomLeft: pointSchema,
});

export const colorBackgroundSchema = z.object({
  type: z.literal('color'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const imageBackgroundSchema = z.object({
  type: z.literal('image'),
  assetId: z.string().min(1),
  fit: fitModeSchema,
  blur: z.number().min(0).max(120),
  opacity: z.number().min(0).max(1),
  overlay: z.object({
    enabled: z.boolean(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    opacity: z.number().min(0).max(1),
  }),
});

export const pptPageBackgroundSchema = z.object({
  type: z.literal('ppt_page'),
  page: z.number().int().positive(),
  fit: fitModeSchema,
  blur: z.number().min(0).max(120),
  opacity: z.number().min(0).max(1),
  overlay: z.object({
    enabled: z.boolean(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    opacity: z.number().min(0).max(1),
  }),
});

export const backgroundConfigSchema = z.discriminatedUnion('type', [
  colorBackgroundSchema,
  imageBackgroundSchema,
  pptPageBackgroundSchema,
]);

export const assetRefSchema = z.object({
  id: z.string().min(1),
  type: z.literal('image'),
  path: assetPathSchema,
  originalName: z.string().min(1),
});

export const pptFrameConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal('ppt_page'),
  page: z.number().int().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
  sourceRatio: sourceRatioSchema,
  transformMode: frameTransformModeSchema.default('locked'),
  corners: quadCornersSchema.optional(),
  fit: fitModeSchema,
  opacity: z.number().min(0).max(1),
  feather: z.number().min(0).max(120),
  blendMode: blendModeSchema,
  radius: z.number().min(0).max(120),
  shadow: z.object({
    enabled: z.boolean(),
    x: z.number().finite(),
    y: z.number().finite(),
    blur: z.number().min(0).max(160),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    opacity: z.number().min(0).max(1),
  }),
  border: z.object({
    enabled: z.boolean(),
    width: z.number().min(0).max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    opacity: z.number().min(0).max(1),
  }),
});

export const textBlockConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal('fixed_text'),
  text: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  fontSize: z.number().min(12).max(220),
  fontFamily: z.string().min(1),
  fontWeight: z.string().min(1),
  colorMode: textColorModeSchema.default('fixed'),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundOpacity: z.number().min(0).max(1),
  padding: z.number().min(0).max(120),
  radius: z.number().min(0).max(120),
  opacity: z.number().min(0).max(1),
});

export const canvasOutputSchema = z.object({
  index: z.number().int().positive(),
  name: z.string().min(1),
  canvas: z.object({
    ratio: canvasRatioSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  background: backgroundConfigSchema,
  frames: z.array(pptFrameConfigSchema),
  textBlocks: z.array(textBlockConfigSchema).default([]),
});

export const templatePackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    source: z.object({
      type: z.literal('ppt'),
      defaultRatio: sourceRatioSchema,
    }),
    maxOutputs: z.number().int().positive().max(18),
    batchRule: z
      .object({
        sourceOutputIndex: z.number().int().positive(),
        count: z.number().int().positive(),
        pageStep: z.number().int(),
        createdAt: z.string(),
      })
      .optional(),
    outputs: z.array(canvasOutputSchema).min(1).max(18),
    assets: z.array(assetRefSchema),
    metadata: z.object({
      createdAt: z.string(),
      updatedAt: z.string(),
      createdBy: z.string().min(1),
    }),
  })
  .superRefine((template, context) => {
    if (template.outputs.length > template.maxOutputs) {
      context.addIssue({
        code: 'custom',
        message: 'outputs cannot exceed maxOutputs',
        path: ['outputs'],
      });
    }

    const assetIds = new Set(template.assets.map((asset) => asset.id));
    template.outputs.forEach((output, outputIndex) => {
      if (output.background.type === 'image' && !assetIds.has(output.background.assetId)) {
        context.addIssue({
          code: 'custom',
          message: `missing background asset ${output.background.assetId}`,
          path: ['outputs', outputIndex, 'background', 'assetId'],
        });
      }
      output.frames.forEach((frame, frameIndex) => {
        const expectedHeight = Math.round(frame.w / (16 / 9));
        if (frame.transformMode === 'locked' && frame.sourceRatio === '16:9' && Math.abs(frame.h - expectedHeight) > 1) {
          context.addIssue({
            code: 'custom',
            message: '16:9 frames must preserve aspect ratio',
            path: ['outputs', outputIndex, 'frames', frameIndex, 'h'],
          });
        }
        if (frame.transformMode === 'perspective' && !frame.corners) {
          context.addIssue({
            code: 'custom',
            message: 'perspective frames require four corners',
            path: ['outputs', outputIndex, 'frames', frameIndex, 'corners'],
          });
        }
      });
    });
  });

export type AssetRef = z.infer<typeof assetRefSchema>;
export type BackgroundConfig = z.infer<typeof backgroundConfigSchema>;
export type CanvasOutput = z.infer<typeof canvasOutputSchema>;
export type CanvasRatio = z.infer<typeof canvasRatioSchema>;
export type FitMode = z.infer<typeof fitModeSchema>;
export type FrameTransformMode = z.infer<typeof frameTransformModeSchema>;
export type Point = z.infer<typeof pointSchema>;
export type QuadCorners = z.infer<typeof quadCornersSchema>;
export type PptFrameConfig = z.infer<typeof pptFrameConfigSchema>;
export type TextColorMode = z.infer<typeof textColorModeSchema>;
export type TextBlockConfig = z.infer<typeof textBlockConfigSchema>;
export type TemplatePackage = z.infer<typeof templatePackageSchema>;
