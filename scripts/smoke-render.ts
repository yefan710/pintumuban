import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fitRect } from '../src/renderer/geometry.ts';
import {
  templatePackageSchema,
  type BackgroundConfig,
  type CanvasOutput,
  type PptFrameConfig,
} from '../src/schema/template.schema.ts';

const templatePath = resolve('templates/sample-template.json');
const outputPath = resolve('output/golden-smoke.png');

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createPlaceholderSlide(page: number) {
  const canvas = createCanvas(1600, 900);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = page % 2 === 0 ? '#dff4f3' : '#eaf0ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d4f75';
  ctx.font = 'bold 92px sans-serif';
  ctx.fillText(`PPT PAGE ${page}`, 110, 160);
  ctx.strokeStyle = '#00a6a6';
  ctx.lineWidth = 12;
  ctx.strokeRect(100, 230, 1400, 520);
  ctx.fillStyle = '#123';
  ctx.font = '44px sans-serif';
  ctx.fillText('Placeholder slide used by smoke renderer', 150, 340);
  ctx.fillText('16:9 source, rendered through template.json', 150, 430);
  ctx.fillText(`Page binding: ${page}`, 150, 520);
  return canvas;
}

function drawFrame(ctx: CanvasRenderingContext2D, frame: PptFrameConfig) {
  const slide = createPlaceholderSlide(frame.page);
  const fitted = fitRect(slide.width, slide.height, { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, frame.fit);

  ctx.save();
  drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius);
  ctx.clip();
  ctx.globalAlpha = frame.opacity;
  ctx.drawImage(slide, fitted.x, fitted.y, fitted.w, fitted.h);
  ctx.restore();

  if (frame.border.enabled && frame.border.width > 0) {
    ctx.save();
    drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius);
    ctx.globalAlpha = frame.border.opacity;
    ctx.strokeStyle = frame.border.color;
    ctx.lineWidth = frame.border.width;
    ctx.stroke();
    ctx.restore();
  }
}

function drawPptPageBackground(
  ctx: CanvasRenderingContext2D,
  background: Extract<BackgroundConfig, { type: 'ppt_page' }>,
  output: CanvasOutput,
) {
  const slide = createPlaceholderSlide(background.page);
  const fitted = fitRect(slide.width, slide.height, { x: 0, y: 0, w: output.canvas.width, h: output.canvas.height }, background.fit);

  ctx.save();
  ctx.globalAlpha = background.opacity;
  ctx.filter = background.blur > 0 ? `blur(${background.blur}px)` : 'none';
  ctx.drawImage(slide, fitted.x, fitted.y, fitted.w, fitted.h);
  ctx.restore();

  if (background.overlay.enabled) {
    ctx.save();
    ctx.fillStyle = background.overlay.color;
    ctx.globalAlpha = background.overlay.opacity;
    ctx.fillRect(0, 0, output.canvas.width, output.canvas.height);
    ctx.restore();
  }
}

function renderOutput(output: CanvasOutput) {
  const canvas = createCanvas(output.canvas.width, output.canvas.height);
  const ctx = canvas.getContext('2d');
  if (output.background.type === 'color') {
    ctx.fillStyle = output.background.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (output.background.type === 'ppt_page') {
    drawPptPageBackground(ctx, output.background, output);
  } else {
    ctx.fillStyle = '#f3efe7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const frame of output.frames) {
    drawFrame(ctx, frame);
  }

  return canvas;
}

const rawTemplate = JSON.parse(await readFile(templatePath, 'utf8')) as unknown;
const template = templatePackageSchema.parse(rawTemplate);
const canvas = renderOutput(template.outputs[0]);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, canvas.toBuffer('image/png'));
console.log(`Smoke render wrote ${outputPath}`);
