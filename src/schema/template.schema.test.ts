import { describe, expect, it } from 'vitest';
import { createFrame, createTemplateGroup, createTextBlock } from '../domain/template';
import { templatePackageSchema } from './template.schema';

describe('templatePackageSchema', () => {
  it('accepts a valid starter template', () => {
    expect(templatePackageSchema.safeParse(createTemplateGroup()).success).toBe(true);
  });

  it('defaults older frame templates to locked mode', () => {
    const template = createTemplateGroup();
    const legacyFrame = { ...createFrame(1) } as Partial<ReturnType<typeof createFrame>>;
    delete legacyFrame.transformMode;
    delete legacyFrame.corners;
    template.outputs[0].frames = [legacyFrame as ReturnType<typeof createFrame>];

    const result = templatePackageSchema.safeParse(template);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outputs[0].frames[0].transformMode).toBe('locked');
    }
  });

  it('rejects absolute asset paths', () => {
    const template = {
      ...createTemplateGroup(),
      assets: [{ id: 'bg', type: 'image', path: '/Users/admin/bg.png', originalName: 'bg.png' }],
    };
    expect(templatePackageSchema.safeParse(template).success).toBe(false);
  });

  it('rejects missing background assets', () => {
    const template = createTemplateGroup();
    template.outputs[0].background = {
      type: 'image',
      assetId: 'missing',
      fit: 'cover',
      blur: 10,
      opacity: 0.5,
      overlay: { enabled: true, color: '#ffffff', opacity: 0.2 },
    };
    expect(templatePackageSchema.safeParse(template).success).toBe(false);
  });

  it('rejects invalid frame pages', () => {
    const template = createTemplateGroup();
    template.outputs[0].frames = [{ ...createFrame(1), page: 0 }];
    expect(templatePackageSchema.safeParse(template).success).toBe(false);
  });

  it('accepts perspective frames with four corners', () => {
    const template = createTemplateGroup();
    template.outputs[0].frames = [{
      ...createFrame(1),
      h: 600,
      transformMode: 'perspective',
      corners: {
        topLeft: { x: 90, y: 120 },
        topRight: { x: 780, y: 92 },
        bottomRight: { x: 820, y: 540 },
        bottomLeft: { x: 72, y: 512 },
      },
    }];
    expect(templatePackageSchema.safeParse(template).success).toBe(true);
  });

  it('rejects perspective frames without corners', () => {
    const template = createTemplateGroup();
    template.outputs[0].frames = [{
      ...createFrame(1),
      h: 600,
      transformMode: 'perspective',
      corners: undefined,
    }];
    expect(templatePackageSchema.safeParse(template).success).toBe(false);
  });

  it('accepts fixed art text blocks', () => {
    const template = createTemplateGroup();
    template.outputs[0].textBlocks = [createTextBlock()];
    expect(templatePackageSchema.safeParse(template).success).toBe(true);
  });

  it('defaults older art text blocks to fixed color mode', () => {
    const template = createTemplateGroup();
    const legacyTextBlock = { ...createTextBlock() } as Partial<ReturnType<typeof createTextBlock>>;
    delete legacyTextBlock.colorMode;
    template.outputs[0].textBlocks = [legacyTextBlock as ReturnType<typeof createTextBlock>];

    const result = templatePackageSchema.safeParse(template);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outputs[0].textBlocks[0].colorMode).toBe('fixed');
    }
  });

  it('accepts auto accent art text blocks', () => {
    const template = createTemplateGroup();
    template.outputs[0].textBlocks = [{ ...createTextBlock(), colorMode: 'autoAccent' }];
    expect(templatePackageSchema.safeParse(template).success).toBe(true);
  });

  it('accepts a PPT page as a dynamic background source', () => {
    const template = createTemplateGroup();
    template.outputs[0].background = {
      type: 'ppt_page',
      page: 1,
      fit: 'cover',
      blur: 24,
      opacity: 0.7,
      overlay: { enabled: true, color: '#ffffff', opacity: 0.2 },
    };
    expect(templatePackageSchema.safeParse(template).success).toBe(true);
  });

  it('rejects invalid PPT background pages', () => {
    const template = createTemplateGroup();
    template.outputs[0].background = {
      type: 'ppt_page',
      page: 0,
      fit: 'cover',
      blur: 24,
      opacity: 0.7,
      overlay: { enabled: true, color: '#ffffff', opacity: 0.2 },
    };
    expect(templatePackageSchema.safeParse(template).success).toBe(false);
  });

  it('rejects more than 18 outputs', () => {
    const template = createTemplateGroup();
    template.outputs = Array.from({ length: 19 }, (_, index) => ({
      ...template.outputs[0],
      index: index + 1,
      name: `图 ${index + 1}`,
    }));
    expect(templatePackageSchema.safeParse(template).success).toBe(false);
  });
});
