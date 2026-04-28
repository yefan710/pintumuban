import { describe, expect, it } from 'vitest';
import { createFrame, createTemplateGroup } from '../domain/template';
import { templatePackageSchema } from './template.schema';

describe('templatePackageSchema', () => {
  it('accepts a valid starter template', () => {
    expect(templatePackageSchema.safeParse(createTemplateGroup()).success).toBe(true);
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
