import JSZip from 'jszip';
import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import './App.css';
import {
  addFrameToOutput,
  batchDuplicateOutput,
  createTemplateGroup,
  duplicateOutput,
  getCanvasSize,
  MAX_OUTPUTS,
  PPT_RATIO,
  validateTemplate,
} from './domain/template';
import type {
  AssetRef,
  BackgroundConfig,
  CanvasOutput,
  CanvasRatio,
  FitMode,
  PptFrameConfig,
  TemplatePackage,
} from './schema/template.schema';

type AssetData = Record<string, string>;
type PptPageData = Record<number, string>;
interface LocalDraft {
  template: TemplatePackage;
  assetData: AssetData;
  status: string;
}

const canvasRatios: CanvasRatio[] = ['9:16', '3:4', '1:1'];
const fitModes: FitMode[] = ['contain', 'cover'];
const blendModes = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const;
const fitLabels: Record<FitMode, string> = {
  contain: '包含',
  cover: '覆盖',
};
const blendModeLabels: Record<(typeof blendModes)[number], string> = {
  normal: '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  'soft-light': '柔光',
};

function makeAssetId() {
  return `asset_${crypto.randomUUID().slice(0, 8)}`;
}

function sanitizeAssetName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToUint8Array(dataUrl: string) {
  const [, base64 = ''] = dataUrl.split(',');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function inferPageFromFilename(filename: string, fallback: number) {
  const match = filename.match(/(?:^|[^0-9])(\d{1,3})(?:[^0-9]|$)/);
  if (!match) return fallback;
  return Math.max(1, Number(match[1]));
}

function useImageSource(src?: string) {
  const [loaded, setLoaded] = useState<{ image: HTMLImageElement; src: string } | null>(null);

  useEffect(() => {
    if (!src) {
      return;
    }
    const next = new window.Image();
    next.onload = () => setLoaded({ image: next, src });
    next.src = src;
  }, [src]);

  if (!loaded || loaded.src !== src) return null;
  return loaded.image;
}

function readInitialDraft(): LocalDraft | null {
  const fallback = null;
  try {
    const rawDraft = localStorage.getItem('ppt-template-studio:draft');
    if (!rawDraft) return fallback;
    const parsed = JSON.parse(rawDraft) as { template: TemplatePackage; assetData: AssetData };
    const result = validateTemplate(parsed.template);
    if (!result.success) return fallback;
    return {
      template: result.data,
      assetData: parsed.assetData ?? {},
      status: '已恢复本地草稿',
    };
  } catch {
    return {
      template: createTemplateGroup(),
      assetData: {},
      status: '本地草稿无法恢复，已新建模板',
    };
  }
}

type ImageLikeBackground = Extract<BackgroundConfig, { type: 'image' | 'ppt_page' }>;

function BackgroundImage({
  background,
  src,
  width,
  height,
}: {
  background: ImageLikeBackground;
  src?: string;
  width: number;
  height: number;
}) {
  const image = useImageSource(src);
  if (!image) {
    return <Rect width={width} height={height} fill="#f2f4f7" />;
  }

  const imageRatio = image.width / image.height;
  const canvasRatio = width / height;
  const cover = background.fit === 'cover';
  const scale = cover
    ? Math.max(width / image.width, height / image.height)
    : Math.min(width / image.width, height / image.height);
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  const blurFilters = background.blur > 0 ? [Konva.Filters.Blur] : [];

  return (
    <>
      <KonvaImage
        image={image}
        x={(width - renderedWidth) / 2}
        y={(height - renderedHeight) / 2}
        width={renderedWidth}
        height={renderedHeight}
        opacity={background.opacity}
        filters={blurFilters}
        blurRadius={background.blur}
        listening={false}
      />
      {imageRatio && canvasRatio ? null : null}
      {background.overlay.enabled ? (
        <Rect
          width={width}
          height={height}
          fill={background.overlay.color}
          opacity={background.overlay.opacity}
          listening={false}
        />
      ) : null}
    </>
  );
}

function PptFrameNode({
  frame,
  isSelected,
  previewSrc,
  onSelect,
  onChange,
}: {
  frame: PptFrameConfig;
  isSelected: boolean;
  previewSrc?: string;
  onSelect: () => void;
  onChange: (frame: PptFrameConfig) => void;
}) {
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const previewImage = useImageSource(previewSrc);

  useEffect(() => {
    if (isSelected && rectRef.current && transformerRef.current) {
      transformerRef.current.nodes([rectRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const previewRect = previewImage ? fitImageToFrame(previewImage, frame) : null;

  return (
    <>
      <Rect
        ref={rectRef}
        x={frame.x}
        y={frame.y}
        width={frame.w}
        height={frame.h}
        fill="#ffffff"
        opacity={frame.opacity}
        cornerRadius={frame.radius}
        stroke={frame.border.enabled ? frame.border.color : '#0b6bcb'}
        strokeWidth={frame.border.enabled ? frame.border.width : isSelected ? 3 : 1}
        dash={frame.border.enabled ? undefined : [10, 8]}
        shadowEnabled={frame.shadow.enabled}
        shadowColor={frame.shadow.color}
        shadowBlur={frame.shadow.blur}
        shadowOffsetX={frame.shadow.x}
        shadowOffsetY={frame.shadow.y}
        shadowOpacity={frame.shadow.opacity}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(event) => {
          onChange({
            ...frame,
            x: Math.round(event.target.x()),
            y: Math.round(event.target.y()),
          });
        }}
        onTransformEnd={() => {
          const node = rectRef.current;
          if (!node) return;
          const width = Math.max(120, node.width() * node.scaleX());
          const height = Math.round(width / PPT_RATIO);
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...frame,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            w: Math.round(width),
            h: height,
          });
        }}
      />
      {previewImage && previewRect ? (
        <Group clipX={frame.x} clipY={frame.y} clipWidth={frame.w} clipHeight={frame.h} listening={false}>
          <KonvaImage
            image={previewImage}
            x={previewRect.x}
            y={previewRect.y}
            width={previewRect.w}
            height={previewRect.h}
            opacity={frame.opacity}
            listening={false}
          />
        </Group>
      ) : null}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.w}
        height={frame.h}
        fillEnabled={false}
        cornerRadius={frame.radius}
        stroke={frame.border.enabled ? frame.border.color : '#0b6bcb'}
        strokeWidth={frame.border.enabled ? frame.border.width : isSelected ? 3 : 1}
        dash={frame.border.enabled ? undefined : [10, 8]}
        listening={false}
      />
      <Text
        x={frame.x + 12}
        y={frame.y + 12}
        text={`P${frame.page} · ${fitLabels[frame.fit]}`}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize={18}
        fill="#0b4f71"
        listening={false}
      />
      {isSelected ? (
        <Transformer
          ref={transformerRef}
          keepRatio
          rotateEnabled={false}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          boundBoxFunc={(_oldBox, newBox) => {
            const width = Math.max(120, Math.abs(newBox.width));
            return {
              ...newBox,
              width,
              height: width / PPT_RATIO,
            };
          }}
        />
      ) : null}
    </>
  );
}

function fitImageToFrame(image: HTMLImageElement, frame: PptFrameConfig) {
  const sourceRatio = image.width / image.height;
  const targetRatio = frame.w / frame.h;
  const scale =
    frame.fit === 'cover'
      ? sourceRatio > targetRatio
        ? frame.h / image.height
        : frame.w / image.width
      : sourceRatio > targetRatio
        ? frame.w / image.width
        : frame.h / image.height;
  const w = image.width * scale;
  const h = image.height * scale;
  return {
    x: frame.x + (frame.w - w) / 2,
    y: frame.y + (frame.h - h) / 2,
    w,
    h,
  };
}

function App() {
  const [initialDraft] = useState(() => readInitialDraft());
  const [template, setTemplate] = useState<TemplatePackage>(() => initialDraft?.template ?? createTemplateGroup());
  const [assetData, setAssetData] = useState<AssetData>(() => initialDraft?.assetData ?? {});
  const [pptPageData, setPptPageData] = useState<PptPageData>({});
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(0);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [status, setStatus] = useState(initialDraft?.status ?? '就绪');
  const [zoom, setZoom] = useState(0.46);
  const [batchDialog, setBatchDialog] = useState({ open: false, count: 2, pageStep: 2 });

  const selectedOutput = template.outputs[selectedOutputIndex] ?? template.outputs[0];
  const selectedFrame = selectedOutput?.frames.find((frame) => frame.id === selectedFrameId) ?? null;
  const validation = useMemo(() => validateTemplate(template), [template]);
  const missingAssets = useMemo(
    () => template.assets.filter((asset) => !assetData[asset.id]).map((asset) => asset.id),
    [assetData, template.assets],
  );
  const missingPreviewPages = useMemo(() => {
    const pages = new Set(template.outputs.flatMap((output) => output.frames.map((frame) => frame.page)));
    return [...pages].filter((page) => !pptPageData[page]).sort((a, b) => a - b);
  }, [pptPageData, template.outputs]);

  useEffect(() => {
    try {
      localStorage.setItem('ppt-template-studio:draft', JSON.stringify({ template, assetData }));
    } catch (error) {
      console.warn('Local draft save failed. Export ZIP to keep a copy of this template.', error);
    }
  }, [assetData, template]);

  function updateTemplate(next: TemplatePackage) {
    setTemplate(next);
  }

  function createFreshTemplate() {
    const confirmed = window.confirm('新建模板会清空当前本地草稿，确定继续吗？');
    if (!confirmed) return;
    const next = createTemplateGroup();
    setTemplate(next);
    setAssetData({});
    setPptPageData({});
    setSelectedOutputIndex(0);
    setSelectedFrameId(null);
    setStatus('已新建空白模板');
  }

  function updateOutput(output: CanvasOutput) {
    updateTemplate({
      ...template,
      metadata: { ...template.metadata, updatedAt: new Date().toISOString() },
      outputs: template.outputs.map((item, index) => (index === selectedOutputIndex ? output : item)),
    });
  }

  function updateSelectedFrame(frame: PptFrameConfig) {
    if (!selectedOutput) return;
    updateOutput({
      ...selectedOutput,
      frames: selectedOutput.frames.map((item) => (item.id === frame.id ? frame : item)),
    });
  }

  function addCanvas() {
    if (template.outputs.length >= MAX_OUTPUTS) {
      setStatus(`已达到 ${MAX_OUTPUTS} 张画布上限`);
      return;
    }
    const next = duplicateOutput(template.outputs.at(-1) ?? selectedOutput, template.outputs.length + 1, 0);
    updateTemplate({
      ...template,
      outputs: [...template.outputs, next],
    });
    setSelectedOutputIndex(template.outputs.length);
    setSelectedFrameId(null);
  }

  function duplicateCanvas() {
    if (!selectedOutput || template.outputs.length >= MAX_OUTPUTS) return;
    const next = duplicateOutput(selectedOutput, template.outputs.length + 1, 0);
    updateTemplate({
      ...template,
      outputs: [...template.outputs, next],
    });
    setSelectedOutputIndex(template.outputs.length);
    setSelectedFrameId(null);
  }

  function batchCreate() {
    setBatchDialog({ open: true, count: 2, pageStep: 2 });
  }

  function confirmBatchCreate() {
    if (!selectedOutput) return;
    const count = batchDialog.count;
    const pageStep = batchDialog.pageStep;
    if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(pageStep)) {
      setStatus('批量创建参数必须是整数');
      return;
    }
    if (template.outputs.length + count > MAX_OUTPUTS) {
      setStatus(`批量创建已阻止：模板组最多 ${MAX_OUTPUTS} 张画布`);
      return;
    }
    const additions = batchDuplicateOutput(selectedOutput, template.outputs.length + 1, count, pageStep);
    updateTemplate({
      ...template,
      batchRule: {
        sourceOutputIndex: selectedOutput.index,
        count,
        pageStep,
        createdAt: new Date().toISOString(),
      },
      outputs: [...template.outputs, ...additions],
    });
    setBatchDialog({ ...batchDialog, open: false });
    setStatus(`已创建 ${count} 张画布`);
  }

  function removeCanvas() {
    if (template.outputs.length <= 1) {
      setStatus('至少需要保留一张画布');
      return;
    }
    updateTemplate({
      ...template,
      outputs: template.outputs.filter((_, index) => index !== selectedOutputIndex).map((output, index) => ({
        ...output,
        index: index + 1,
        name: `图 ${index + 1}`,
      })),
    });
    setSelectedOutputIndex(Math.max(0, selectedOutputIndex - 1));
    setSelectedFrameId(null);
  }

  function clearCurrentCanvas() {
    if (!selectedOutput) return;
    const confirmed = window.confirm('清空当前画布会删除它上面的 PPT 框并重置背景，确定继续吗？');
    if (!confirmed) return;
    updateOutput({
      ...selectedOutput,
      background: {
        type: 'color',
        color: '#f3efe7',
      },
      frames: [],
    });
    setSelectedFrameId(null);
    setStatus(`已清空 ${selectedOutput.name}`);
  }

  function addFrame() {
    if (!selectedOutput) return;
    const next = addFrameToOutput(selectedOutput);
    updateOutput(next.output);
    setSelectedFrameId(next.frame.id);
  }

  function removeFrame() {
    if (!selectedOutput || !selectedFrameId) return;
    updateOutput({
      ...selectedOutput,
      frames: selectedOutput.frames.filter((frame) => frame.id !== selectedFrameId),
    });
    setSelectedFrameId(null);
  }

  async function handleBackgroundUpload(file: File) {
    const dataUrl = await fileToDataUrl(file);
    const id = makeAssetId();
    const extension = file.name.split('.').pop() || 'png';
    const asset: AssetRef = {
      id,
      type: 'image',
      path: `assets/${id}-${sanitizeAssetName(file.name || `background.${extension}`)}`,
      originalName: file.name || `background.${extension}`,
    };
    setAssetData((current) => ({ ...current, [id]: dataUrl }));
    updateTemplate({
      ...template,
      assets: [...template.assets, asset],
      outputs: template.outputs.map((output, index) =>
        index === selectedOutputIndex
          ? {
              ...output,
              background: {
                type: 'image',
                assetId: id,
                fit: 'cover',
                blur: 24,
                opacity: 0.72,
                overlay: { enabled: true, color: '#ffffff', opacity: 0.22 },
              },
            }
          : output,
      ),
    });
  }

  async function handlePptPreviewUpload(files: FileList) {
    const nextPages: PptPageData = {};
    for (const [index, file] of [...files].entries()) {
      const page = inferPageFromFilename(file.name, index + 1);
      nextPages[page] = await fileToDataUrl(file);
    }
    setPptPageData((current) => ({ ...current, ...nextPages }));
    setStatus(`已加载 ${Object.keys(nextPages).length} 张 PPT 页面预览图`);
  }

  function clearPptPreviewImages() {
    setPptPageData({});
    setStatus('已清空 PPT 预览图');
  }

  function updateBackground(background: BackgroundConfig) {
    if (!selectedOutput) return;
    updateOutput({ ...selectedOutput, background });
  }

  function getBackgroundPreviewSource(background: BackgroundConfig) {
    if (background.type === 'image') return assetData[background.assetId];
    if (background.type === 'ppt_page') return pptPageData[background.page];
    return undefined;
  }

  async function exportJson() {
    const parsed = validateTemplate(template);
    if (!parsed.success) {
      setStatus(`导出已阻止：${parsed.error.issues[0]?.message ?? '模板无效'}`);
      return;
    }
    downloadBlob(
      new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }),
      `${template.name}.json`,
    );
  }

  async function exportZip() {
    const parsed = validateTemplate(template);
    if (!parsed.success) {
      setStatus(`导出已阻止：${parsed.error.issues[0]?.message ?? '模板无效'}`);
      return;
    }
    const zip = new JSZip();
    zip.file('template.json', JSON.stringify(template, null, 2));
    for (const asset of template.assets) {
      const dataUrl = assetData[asset.id];
      if (!dataUrl) {
        setStatus(`导出已阻止：缺少素材 ${asset.id}`);
        return;
      }
      zip.file(asset.path, dataUrlToUint8Array(dataUrl));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${template.name}.zip`);
  }

  async function importJson(file: File) {
    const text = await file.text();
    const parsed = validateTemplate(JSON.parse(text));
    if (!parsed.success) {
      setStatus(`导入失败：${parsed.error.issues[0]?.message ?? '模板无效'}`);
      return;
    }
    setTemplate(parsed.data);
    setPptPageData({});
    setSelectedOutputIndex(0);
    setSelectedFrameId(null);
    setStatus('已导入 JSON。图片素材需要重新上传，或改用 ZIP 导入。');
  }

  async function importZip(file: File) {
    const zip = await JSZip.loadAsync(file);
    const unsafe = Object.keys(zip.files).find((path) => path.startsWith('/') || path.includes('..'));
    if (unsafe) {
      setStatus(`导入已阻止：不安全路径 ${unsafe}`);
      return;
    }
    const templateFile = zip.file('template.json');
    if (!templateFile) {
      setStatus('导入失败：缺少 template.json');
      return;
    }
    const parsed = validateTemplate(JSON.parse(await templateFile.async('string')));
    if (!parsed.success) {
      setStatus(`导入失败：${parsed.error.issues[0]?.message ?? '模板无效'}`);
      return;
    }
    const nextAssets: AssetData = {};
    for (const asset of parsed.data.assets) {
      const assetFile = zip.file(asset.path);
      if (!assetFile) {
        setStatus(`导入失败：缺少 ${asset.path}`);
        return;
      }
      nextAssets[asset.id] = await blobToDataUrl(await assetFile.async('blob'));
    }
    setTemplate(parsed.data);
    setAssetData(nextAssets);
    setPptPageData({});
    setSelectedOutputIndex(0);
    setSelectedFrameId(null);
    setStatus('已导入 ZIP 模板包');
  }

  if (!selectedOutput) {
    return null;
  }

  const canvasSize = getCanvasSize(selectedOutput.canvas.ratio);
  const fitScale = Math.min(0.46, 760 / canvasSize.width, 720 / canvasSize.height);
  const stageScale = Math.min(zoom, 760 / canvasSize.width, 720 / canvasSize.height);
  const batchTotal = template.outputs.length + batchDialog.count;
  const batchBlocked = batchTotal > MAX_OUTPUTS || batchDialog.count <= 0 || !Number.isInteger(batchDialog.count);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">TEMPLATE CONTRACT STUDIO</p>
          <input
            className="template-title"
            value={template.name}
            onChange={(event) => updateTemplate({ ...template, name: event.target.value || 'untitled-template' })}
          />
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={createFreshTemplate}>新建模板</button>
          <label className="ghost-button">
            导入 JSON
            <input hidden type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && importJson(event.target.files[0])} />
          </label>
          <label className="ghost-button">
            导入 ZIP
            <input hidden type="file" accept=".zip" onChange={(event) => event.target.files?.[0] && importZip(event.target.files[0])} />
          </label>
          <button type="button" onClick={exportJson}>导出 JSON</button>
          <button type="button" className="primary-button" onClick={exportZip}>导出模板包</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <span>画布列表</span>
            <strong>{template.outputs.length}/{MAX_OUTPUTS}</strong>
          </div>
          <div className="canvas-list">
            {template.outputs.map((output, index) => (
              <button
                className={index === selectedOutputIndex ? 'canvas-item active' : 'canvas-item'}
                key={output.index}
                type="button"
                onClick={() => {
                  setSelectedOutputIndex(index);
                  setSelectedFrameId(null);
                }}
              >
                <span>{output.name}</span>
                <small>{output.canvas.ratio} · {output.frames.map((frame) => `P${frame.page}`).join('/') || '未放置 PPT 框'}</small>
              </button>
            ))}
          </div>
          <div className="button-grid">
            <button type="button" onClick={addCanvas}>新增</button>
            <button type="button" onClick={duplicateCanvas}>复制</button>
            <button type="button" onClick={batchCreate}>批量</button>
            <button type="button" onClick={removeCanvas}>删除</button>
            <button type="button" className="wide-button" onClick={clearCurrentCanvas}>清空当前画布</button>
          </div>
        </aside>

        <section className="stage-panel">
          <div className="stage-toolbar">
            <div>
              <strong>{selectedOutput.name}</strong>
              <span>{selectedOutput.canvas.ratio} · {canvasSize.width} × {canvasSize.height} · 缩放 {Math.round(stageScale * 100)}%</span>
            </div>
            <div className="stage-actions">
              <button type="button" onClick={() => setZoom(fitScale)}>适配窗口</button>
              <button type="button" onClick={() => setSelectedFrameId(null)}>编辑背景</button>
              <label className="ghost-button">
                上传 PPT 图片预览
                <input hidden multiple type="file" accept="image/*" onChange={(event) => event.target.files && handlePptPreviewUpload(event.target.files)} />
              </label>
              <button type="button" onClick={clearPptPreviewImages} disabled={Object.keys(pptPageData).length === 0}>清空预览图</button>
              <label className="zoom-control">
                缩放
                <input
                  type="range"
                  min={0.32}
                  max={0.62}
                  step={0.02}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <button type="button" onClick={() => setStatus('样张验证：请运行 npm run smoke:render 生成 golden-smoke.png')}>样张验证</button>
              <button type="button" className="primary-button" onClick={addFrame}>添加 PPT 框</button>
            </div>
          </div>
          <div className="stage-wrap">
            <Stage
              width={canvasSize.width * stageScale}
              height={canvasSize.height * stageScale}
              scaleX={stageScale}
              scaleY={stageScale}
              className="konva-stage"
              onMouseDown={(event) => {
                if (event.target === event.target.getStage()) setSelectedFrameId(null);
              }}
            >
              <Layer>
                {selectedOutput.background.type === 'color' ? (
                  <Rect width={canvasSize.width} height={canvasSize.height} fill={selectedOutput.background.color} />
                ) : (
                  <BackgroundImage
                    background={selectedOutput.background}
                    src={getBackgroundPreviewSource(selectedOutput.background)}
                    width={canvasSize.width}
                    height={canvasSize.height}
                  />
                )}
                {selectedOutput.frames.map((frame) => (
                  <PptFrameNode
                    frame={frame}
                    isSelected={frame.id === selectedFrameId}
                    key={frame.id}
                    previewSrc={pptPageData[frame.page]}
                    onSelect={() => setSelectedFrameId(frame.id)}
                    onChange={updateSelectedFrame}
                  />
                ))}
              </Layer>
            </Stage>
          </div>
        </section>

        <aside className="inspector">
          <div className="panel-heading">
            <span>{selectedFrame ? 'PPT 框属性' : '画布属性'}</span>
            {selectedFrame ? (
              <div className="panel-heading-actions">
                <button type="button" onClick={() => setSelectedFrameId(null)}>编辑背景</button>
                <button type="button" onClick={removeFrame}>删除框</button>
              </div>
            ) : null}
          </div>

          {!selectedFrame ? (
            <div className="control-stack">
              <PanelSection title="画布设置">
              <label>
                画布比例
                <select
                  value={selectedOutput.canvas.ratio}
                  onChange={(event) => {
                    const ratio = event.target.value as CanvasRatio;
                    updateOutput({ ...selectedOutput, canvas: { ratio, ...getCanvasSize(ratio) } });
                  }}
                >
                  {canvasRatios.map((ratio) => <option key={ratio}>{ratio}</option>)}
                </select>
              </label>
              </PanelSection>
              <PanelSection title="背景设置">
              <label>
                背景类型
                <select
                  value={selectedOutput.background.type}
                  onChange={(event) => {
                    updateBackground(
                      event.target.value === 'color'
                        ? { type: 'color', color: '#f3efe7' }
                        : event.target.value === 'image'
                          ? {
                            type: 'image',
                            assetId: template.assets[0]?.id ?? '',
                            fit: 'cover',
                            blur: 24,
                            opacity: 0.7,
                            overlay: { enabled: true, color: '#ffffff', opacity: 0.22 },
                            }
                          : {
                              type: 'ppt_page',
                              page: selectedOutput.frames[0]?.page ?? 1,
                              fit: 'cover',
                              blur: 24,
                              opacity: 0.7,
                              overlay: { enabled: true, color: '#ffffff', opacity: 0.22 },
                            },
                    );
                  }}
                >
                  <option value="color">纯色</option>
                  <option value="image">固定图片</option>
                  <option value="ppt_page">PPT 页面预览</option>
                </select>
              </label>
              {selectedOutput.background.type === 'color' ? (
                <label>
                  背景颜色
                  <input
                    type="color"
                    value={selectedOutput.background.color}
                    onChange={(event) => updateBackground({ type: 'color', color: event.target.value })}
                  />
                </label>
              ) : selectedOutput.background.type === 'image' ? (
                <ImageBackgroundControls
                  background={selectedOutput.background}
                  onChange={updateBackground}
                  onUpload={handleBackgroundUpload}
                />
              ) : (
                <PptPageBackgroundControls
                  background={selectedOutput.background}
                  onChange={updateBackground}
                  hasPreview={Boolean(pptPageData[selectedOutput.background.page])}
                />
              )}
              </PanelSection>
            </div>
          ) : (
            <FrameInspector frame={selectedFrame} onChange={updateSelectedFrame} />
          )}
        </aside>
      </section>

      <footer className={validation.success && missingAssets.length === 0 ? 'status ok' : 'status bad'}>
        <span>{validation.success ? '模板合同有效' : `模板合同异常：${validation.error.issues[0]?.message}`}</span>
        <span>{missingAssets.length === 0 ? '素材完整' : `缺少素材：${missingAssets.join(', ')}`}</span>
        <span>{missingPreviewPages.length === 0 ? 'PPT 预览完整' : `缺少预览页：P${missingPreviewPages.join('/P')}`}</span>
        <span>{status}</span>
      </footer>

      {batchDialog.open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setBatchDialog({ ...batchDialog, open: false })}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="batch-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <span id="batch-title">批量创建画布</span>
              <button type="button" onClick={() => setBatchDialog({ ...batchDialog, open: false })}>关闭</button>
            </div>
            <div className="control-stack">
              <PanelSection title="创建规则">
                <label>
                  创建数量
                  <input
                    type="number"
                    min={1}
                    max={MAX_OUTPUTS - template.outputs.length}
                    value={batchDialog.count}
                    onChange={(event) => setBatchDialog({ ...batchDialog, count: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
                  />
                </label>
                <label>
                  页码步长
                  <input
                    type="number"
                    step={1}
                    value={batchDialog.pageStep}
                    onChange={(event) => setBatchDialog({ ...batchDialog, pageStep: Math.round(Number(event.target.value) || 0) })}
                  />
                </label>
              </PanelSection>
              <p className={batchBlocked ? 'batch-summary blocked' : 'batch-summary'}>
                将从当前画布复制 {batchDialog.count} 张，页码每张 +{batchDialog.pageStep}，完成后共 {batchTotal}/{MAX_OUTPUTS} 张。
              </p>
              <div className="modal-actions">
                <button type="button" onClick={() => setBatchDialog({ ...batchDialog, open: false })}>取消</button>
                <button type="button" className="primary-button" disabled={batchBlocked} onClick={confirmBatchCreate}>确认创建</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function PanelSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="panel-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ImageBackgroundControls({
  background,
  onChange,
  onUpload,
}: {
  background: Extract<BackgroundConfig, { type: 'image' }>;
  onChange: (background: BackgroundConfig) => void;
  onUpload: (file: File) => void;
}) {
  return (
    <>
      <label>
        上传背景图
        <input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
      </label>
      <label>
        适配方式
        <select
          value={background.fit}
          onChange={(event) => onChange({ ...background, fit: event.target.value as FitMode })}
        >
          {fitModes.map((mode) => <option key={mode} value={mode}>{fitLabels[mode]}</option>)}
        </select>
      </label>
      <Range label="背景模糊" max={80} value={background.blur} onChange={(value) => onChange({ ...background, blur: value })} />
      <Range label="背景透明度" max={1} step={0.01} value={background.opacity} onChange={(value) => onChange({ ...background, opacity: value })} />
      <label>
        蒙层颜色
        <input
          type="color"
          value={background.overlay.color}
          onChange={(event) => onChange({ ...background, overlay: { ...background.overlay, color: event.target.value } })}
        />
      </label>
      <Range
        label="蒙层透明度"
        max={1}
        step={0.01}
        value={background.overlay.opacity}
        onChange={(value) => onChange({ ...background, overlay: { ...background.overlay, enabled: value > 0, opacity: value } })}
      />
    </>
  );
}

function PptPageBackgroundControls({
  background,
  hasPreview,
  onChange,
}: {
  background: Extract<BackgroundConfig, { type: 'ppt_page' }>;
  hasPreview: boolean;
  onChange: (background: BackgroundConfig) => void;
}) {
  return (
    <>
      <label>
        背景绑定 PPT 页
        <input
          type="number"
          min={1}
          step={1}
          value={background.page}
          onChange={(event) => onChange({ ...background, page: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
        />
      </label>
      <p className={hasPreview ? 'hint ok' : 'hint warning'}>
        {hasPreview ? `已使用 P${background.page} 作为动态背景` : `还没有上传 P${background.page} 的 PPT 预览图`}
      </p>
      <label>
        适配方式
        <select
          value={background.fit}
          onChange={(event) => onChange({ ...background, fit: event.target.value as FitMode })}
        >
          {fitModes.map((mode) => <option key={mode} value={mode}>{fitLabels[mode]}</option>)}
        </select>
      </label>
      <Range label="背景模糊" max={80} value={background.blur} onChange={(value) => onChange({ ...background, blur: value })} />
      <Range label="背景透明度" max={1} step={0.01} value={background.opacity} onChange={(value) => onChange({ ...background, opacity: value })} />
      <label>
        蒙层颜色
        <input
          type="color"
          value={background.overlay.color}
          onChange={(event) => onChange({ ...background, overlay: { ...background.overlay, color: event.target.value } })}
        />
      </label>
      <Range
        label="蒙层透明度"
        max={1}
        step={0.01}
        value={background.overlay.opacity}
        onChange={(value) => onChange({ ...background, overlay: { ...background.overlay, enabled: value > 0, opacity: value } })}
      />
    </>
  );
}

function Range({
  label,
  max,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label>
      {label} <small>{typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : value}</small>
      <input type="range" min={0} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function FrameInspector({ frame, onChange }: { frame: PptFrameConfig; onChange: (frame: PptFrameConfig) => void }) {
  return (
    <div className="control-stack">
      <PanelSection title="页码与适配">
      <label>
        绑定 PPT 页码
        <input
          type="number"
          min={1}
          step={1}
          value={frame.page}
          onChange={(event) => onChange({ ...frame, page: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
        />
      </label>
      <label>
        适配方式
        <select value={frame.fit} onChange={(event) => onChange({ ...frame, fit: event.target.value as FitMode })}>
          {fitModes.map((mode) => <option key={mode} value={mode}>{fitLabels[mode]}</option>)}
        </select>
      </label>
      </PanelSection>
      <PanelSection title="位置尺寸">
      <div className="two-cols">
        <label>X<input type="number" value={frame.x} onChange={(event) => onChange({ ...frame, x: Number(event.target.value) })} /></label>
        <label>Y<input type="number" value={frame.y} onChange={(event) => onChange({ ...frame, y: Number(event.target.value) })} /></label>
      </div>
      <label>
        宽度
        <input
          type="number"
          min={120}
          value={frame.w}
          onChange={(event) => {
            const width = Math.max(120, Number(event.target.value) || 120);
            onChange({ ...frame, w: width, h: Math.round(width / PPT_RATIO) });
          }}
        />
      </label>
      </PanelSection>
      <PanelSection title="视觉效果">
      <Range label="透明度" max={1} step={0.01} value={frame.opacity} onChange={(value) => onChange({ ...frame, opacity: value })} />
      <Range label="羽化" max={80} value={frame.feather} onChange={(value) => onChange({ ...frame, feather: value })} />
      <label>
        混合模式
        <select value={frame.blendMode} onChange={(event) => onChange({ ...frame, blendMode: event.target.value as PptFrameConfig['blendMode'] })}>
          {blendModes.map((mode) => <option key={mode} value={mode}>{blendModeLabels[mode]}</option>)}
        </select>
      </label>
      <Range label="圆角" max={80} value={frame.radius} onChange={(value) => onChange({ ...frame, radius: value })} />
      </PanelSection>
      <PanelSection title="阴影与边框">
      <label className="toggle">
        <input type="checkbox" checked={frame.shadow.enabled} onChange={(event) => onChange({ ...frame, shadow: { ...frame.shadow, enabled: event.target.checked } })} />
        启用阴影
      </label>
      <Range label="阴影模糊" max={80} value={frame.shadow.blur} onChange={(value) => onChange({ ...frame, shadow: { ...frame.shadow, blur: value } })} />
      <label className="toggle">
        <input type="checkbox" checked={frame.border.enabled} onChange={(event) => onChange({ ...frame, border: { ...frame.border, enabled: event.target.checked } })} />
        启用边框
      </label>
      <Range label="边框宽度" max={12} value={frame.border.width} onChange={(value) => onChange({ ...frame, border: { ...frame.border, width: value } })} />
      </PanelSection>
    </div>
  );
}

export default App;
