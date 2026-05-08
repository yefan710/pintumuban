import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fitRect } from '../src/renderer/geometry.ts';
import {
  templatePackageSchema,
  type BackgroundConfig,
  type CanvasOutput,
  type PptFrameConfig,
  type TextBlockConfig,
} from '../src/schema/template.schema.ts';

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
const PPT_EXTENSIONS = new Set(['.ppt', '.pptx']);

interface CliArgs {
  input: string;
  template: string;
  output: string;
  timeoutSeconds: number;
}

interface PptSummary {
  file: string;
  status: 'success' | 'failed';
  slideCount: number;
  folder: string;
  error: string | null;
  warnings?: string[];
}

interface PowerPointExportResult {
  slideCount: number;
}

function printHelp() {
  console.log(`Usage:
  tsx scripts/export-ppt-notes.ts --input <ppt-folder> --template <template-json> --output <output-folder> [--timeout-seconds 180]

Exports each PPT/PPTX to page_###.png images and renders collage.png with the template.
If page_###.png files already exist in an output folder, they are reused and only collage.png is regenerated.`);
}

function parseArgs(argv: string[]): CliArgs | null {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return null;
  }

  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    values.set(arg.slice(2), value);
    i += 1;
  }

  const input = values.get('input');
  const template = values.get('template');
  const output = values.get('output');
  const timeoutSeconds = Number(values.get('timeout-seconds') ?? '180');
  if (!input || !template || !output) {
    throw new Error('Missing required arguments: --input, --template, --output');
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('--timeout-seconds must be a positive number');
  }

  return {
    input: resolve(input),
    template: resolve(template),
    output: resolve(output),
    timeoutSeconds,
  };
}

function sanitizeFolderName(name: string) {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  const safeName = cleaned || 'ppt';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return reserved.test(safeName) ? `${safeName}_` : safeName;
}

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

function pagePath(folder: string, page: number) {
  return join(folder, `page_${String(page).padStart(3, '0')}.png`);
}

async function loadSlide(folder: string, page: number) {
  const imageBytes = await readFile(pagePath(folder, page));
  return loadImage(imageBytes);
}

function drawImageSource(
  ctx: CanvasRenderingContext2D,
  image: Canvas | Image,
  sourceWidth: number,
  sourceHeight: number,
  target: { x: number; y: number; w: number; h: number },
  fit: 'contain' | 'cover',
) {
  const fitted = fitRect(sourceWidth, sourceHeight, target, fit);
  ctx.drawImage(image, fitted.x, fitted.y, fitted.w, fitted.h);
}

async function drawFrame(ctx: CanvasRenderingContext2D, frame: PptFrameConfig, pagesFolder: string) {
  const slide = await loadSlide(pagesFolder, frame.page);
  const sourceWidth = slide.width;
  const sourceHeight = slide.height;

  if (frame.shadow.enabled) {
    const shadowCanvas = createCanvas(ctx.canvas.width, ctx.canvas.height);
    const shadowCtx = shadowCanvas.getContext('2d');
    shadowCtx.save();
    drawRoundedRect(shadowCtx, frame.x, frame.y, frame.w, frame.h, frame.radius);
    shadowCtx.shadowOffsetX = frame.shadow.x;
    shadowCtx.shadowOffsetY = frame.shadow.y;
    shadowCtx.shadowBlur = frame.shadow.blur;
    shadowCtx.shadowColor = withAlpha(frame.shadow.color, frame.shadow.opacity);
    shadowCtx.fillStyle = withAlpha(frame.shadow.color, frame.shadow.opacity);
    shadowCtx.fill();
    shadowCtx.globalCompositeOperation = 'destination-out';
    drawRoundedRect(shadowCtx, frame.x, frame.y, frame.w, frame.h, frame.radius);
    shadowCtx.fill();
    shadowCtx.restore();
    ctx.drawImage(shadowCanvas, 0, 0);
  }

  ctx.save();
  drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius);
  ctx.clip();
  ctx.globalAlpha = frame.opacity;
  ctx.globalCompositeOperation = toCompositeOperation(frame.blendMode);
  drawImageSource(ctx, slide, sourceWidth, sourceHeight, { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, frame.fit);
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let current = '';
    for (const char of rawLine) {
      const next = `${current}${char}`;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function drawTextBlock(ctx: CanvasRenderingContext2D, block: TextBlockConfig) {
  const lineHeight = block.fontSize * 1.16;
  const innerWidth = Math.max(40, block.w - block.padding * 2);
  ctx.save();
  ctx.font = `${block.fontWeight} ${block.fontSize}px ${block.fontFamily}`;
  const lines = wrapText(ctx, block.text || ' ', innerWidth);
  const height = Math.round(block.padding * 2 + lines.length * lineHeight);

  ctx.globalAlpha = block.backgroundOpacity * block.opacity;
  ctx.fillStyle = block.backgroundColor;
  drawRoundedRect(ctx, block.x, block.y, block.w, height, block.radius);
  ctx.fill();

  ctx.globalAlpha = block.opacity;
  ctx.fillStyle = block.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, block.x + block.w / 2, block.y + block.padding + index * lineHeight, innerWidth);
  });
  ctx.restore();
}

async function drawPptPageBackground(
  ctx: CanvasRenderingContext2D,
  background: Extract<BackgroundConfig, { type: 'ppt_page' }>,
  output: CanvasOutput,
  pagesFolder: string,
) {
  const slide = await loadSlide(pagesFolder, background.page);

  ctx.save();
  ctx.globalAlpha = background.opacity;
  (ctx as CanvasRenderingContext2D & { filter: string }).filter = background.blur > 0 ? `blur(${background.blur}px)` : 'none';
  drawImageSource(
    ctx,
    slide,
    slide.width,
    slide.height,
    { x: 0, y: 0, w: output.canvas.width, h: output.canvas.height },
    background.fit,
  );
  ctx.restore();

  if (background.overlay.enabled) {
    ctx.save();
    ctx.fillStyle = background.overlay.color;
    ctx.globalAlpha = background.overlay.opacity;
    ctx.fillRect(0, 0, output.canvas.width, output.canvas.height);
    ctx.restore();
  }
}

async function renderOutput(output: CanvasOutput, pagesFolder: string) {
  const canvas = createCanvas(output.canvas.width, output.canvas.height);
  const ctx = canvas.getContext('2d');

  if (output.background.type === 'color') {
    ctx.fillStyle = output.background.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (output.background.type === 'ppt_page') {
    await drawPptPageBackground(ctx, output.background, output, pagesFolder);
  } else {
    ctx.fillStyle = '#f3efe7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const frame of output.frames) {
    await drawFrame(ctx, frame, pagesFolder);
  }

  for (const block of output.textBlocks ?? []) {
    drawTextBlock(ctx, block);
  }

  return canvas;
}

function referencedPages(output: CanvasOutput) {
  const pages = output.frames.map((frame) => frame.page);
  if (output.background.type === 'ppt_page') {
    pages.push(output.background.page);
  }
  return pages;
}

async function renderCollage(outputs: CanvasOutput[], pagesFolder: string, collagePath: string) {
  const rendered = new Array<Canvas>();
  for (const output of outputs) {
    rendered.push(await renderOutput(output, pagesFolder));
  }

  const width = Math.max(...rendered.map((canvas) => canvas.width));
  const height = rendered.reduce((sum, canvas) => sum + canvas.height, 0);
  const collage = createCanvas(width, height);
  const ctx = collage.getContext('2d');

  let y = 0;
  for (const canvas of rendered) {
    ctx.drawImage(canvas, 0, y);
    y += canvas.height;
  }

  await writeFile(collagePath, collage.toBuffer('image/png'));
}

function withAlpha(hex: string, alpha: number) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toCompositeOperation(blendMode: PptFrameConfig['blendMode']): CanvasRenderingContext2D['globalCompositeOperation'] {
  if (blendMode === 'normal') {
    return 'source-over';
  }
  if (blendMode === 'soft-light') {
    return 'soft-light';
  }
  return blendMode;
}

async function findPpts(inputFolder: string) {
  const entries = await readdir(inputFolder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && PPT_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(inputFolder, entry.name))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function runCommand(command: string, args: string[], timeoutSeconds: number) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`PowerPoint export timed out after ${timeoutSeconds}s`));
        return;
      }
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with ${code}`));
      }
    });
  });
}

async function exportWithPowerPoint(pptPath: string, outputFolder: string, timeoutSeconds: number): Promise<PowerPointExportResult> {
  const tempFolder = await mkdtemp(join(tmpdir(), 'ppt-export-'));
  const scriptPath = join(tempFolder, 'export.py');
  const script = String.raw`
import gc
import json
import os
import sys
import time

import pythoncom
import win32com.client

EXPORT_WIDTH = 1920
EXPORT_HEIGHT = 1080


def main():
    ppt_path = sys.argv[1]
    output_folder = sys.argv[2]
    os.makedirs(output_folder, exist_ok=True)

    pythoncom.CoInitialize()
    powerpoint = None
    presentation = None
    try:
        last_error = None
        for attempt in range(1, 6):
            try:
                powerpoint = win32com.client.Dispatch("PowerPoint.Application")
                break
            except Exception as error:
                last_error = error
                time.sleep(2)
        if powerpoint is None:
            raise last_error or RuntimeError("Could not start PowerPoint COM")

        presentation = powerpoint.Presentations.Open(ppt_path, False, True, False)
        count = presentation.Slides.Count
        for index in range(1, count + 1):
            name = f"page_{index:03d}.png"
            path = os.path.join(output_folder, name)
            presentation.Slides.Item(index).Export(path, "PNG", EXPORT_WIDTH, EXPORT_HEIGHT)
        print(json.dumps({"slideCount": count}, ensure_ascii=False), flush=True)
    finally:
        if presentation is not None:
            presentation.Close()
        if powerpoint is not None:
            powerpoint.Quit()
        pythoncom.CoUninitialize()
        gc.collect()


if __name__ == "__main__":
    main()
`;

  await writeFile(scriptPath, script, 'utf8');
  try {
    const stdout = await runCommand('python', [scriptPath, pptPath, outputFolder], timeoutSeconds);
    const jsonLine = stdout
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('{'));
    if (!jsonLine) {
      throw new Error('PowerPoint export did not return slide count');
    }
    return JSON.parse(jsonLine) as PowerPointExportResult;
  } finally {
    await rm(tempFolder, { recursive: true, force: true });
  }
}

async function uniqueFolder(baseOutput: string, pptPath: string, usedNames: Set<string>) {
  const original = sanitizeFolderName(basename(pptPath, extname(pptPath)));
  let candidate = original;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${original}_${index}`;
    index += 1;
  }
  usedNames.add(candidate);
  const folder = join(baseOutput, candidate);
  await mkdir(folder, { recursive: true });
  return folder;
}

async function existingSlideCount(folder: string) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const pages = entries
      .filter((entry) => entry.isFile() && /^page_\d{3}\.png$/i.test(entry.name))
      .map((entry) => Number(entry.name.match(/^page_(\d{3})\.png$/i)?.[1] ?? 0))
      .filter((page) => page > 0)
      .sort((a, b) => a - b);
    if (pages.length === 0) {
      return 0;
    }
    let contiguous = 0;
    for (const page of pages) {
      if (page !== contiguous + 1) {
        break;
      }
      contiguous = page;
    }
    return contiguous;
  } catch {
    return 0;
  }
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function processPpt(pptPath: string, outputFolder: string, outputs: CanvasOutput[], timeoutSeconds: number): Promise<PptSummary> {
  const warnings: string[] = [];
  const folder = outputFolder;
  const file = basename(pptPath);

  try {
    const pptStat = await stat(pptPath);
    if (pptStat.size === 0) {
      throw new Error('PPT file is 0 bytes');
    }

    let slideCount = await existingSlideCount(folder);
    if (slideCount > 0) {
      warnings.push(`Reused ${slideCount} existing exported page image(s).`);
    } else {
      const exportResult = await exportWithPowerPoint(pptPath, folder, timeoutSeconds);
      slideCount = exportResult.slideCount;
    }

    const validOutputs = outputs.filter((output) => referencedPages(output).every((page) => page <= slideCount));
    if (validOutputs.length === 0) {
      warnings.push('No valid template outputs for this slide count; collage skipped.');
    } else {
      const collagePath = join(folder, 'collage.png');
      await renderCollage(validOutputs, folder, collagePath);
      if (!(await fileExists(collagePath))) {
        throw new Error('collage.png was not created');
      }
    }

    return {
      file,
      status: 'success',
      slideCount,
      folder,
      error: null,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    return {
      file,
      status: 'failed',
      slideCount: 0,
      folder,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    return;
  }

  await mkdir(args.output, { recursive: true });
  const rawTemplate = JSON.parse(await readFile(args.template, 'utf8')) as unknown;
  const template = templatePackageSchema.parse(rawTemplate);
  const pptPaths = await findPpts(args.input);
  const usedNames = new Set<string>();
  const summaries: PptSummary[] = [];

  for (const pptPath of pptPaths) {
    const folder = await uniqueFolder(args.output, pptPath, usedNames);
    console.log(`Processing ${basename(pptPath)} -> ${folder}`);
    const summary = await processPpt(pptPath, folder, template.outputs, args.timeoutSeconds);
    summaries.push(summary);
    if (summary.status === 'failed') {
      console.warn(`Failed ${summary.file}: ${summary.error}`);
    } else if (summary.warnings?.length) {
      console.warn(`Warnings ${summary.file}: ${summary.warnings.join('; ')}`);
    }
  }

  const summaryPath = join(args.output, 'summary.json');
  await writeFile(summaryPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), items: summaries }, null, 2)}\n`, 'utf8');
  console.log(`Summary wrote ${summaryPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
