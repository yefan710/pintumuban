# Pintumuban: PPT Template Studio + Exporter

A local tool for making social-image templates from PPT pages, then exporting PPT slides into the template regions as final PNG notes.

It has two parts:

- **Template Studio**: a browser editor for building reusable layout templates.
- **PPT Export Workflow**: a Node CLI that uses PowerPoint/WPS COM export on Windows, renders selected PPT pages into the template frames, and writes final `collage.png` outputs.

## Requirements

- Windows
- Node.js 20.19+
- Microsoft PowerPoint or WPS Presentation
- Python 3 with `pywin32` available for COM automation

## Install

```powershell
git clone https://github.com/yefan710/pintumuban.git
cd pintumuban
npm install
```

## Start the Template Studio

```powershell
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173/
```

## Make a Template

1. Choose the canvas ratio: `9:16`, `3:4`, or `1:1`.
2. Set a background: solid color, uploaded image, or a PPT page preview.
3. Add PPT frames. Each frame has a fixed PPT page number, size, position, fit mode, border, radius, shadow, and blend mode.
4. Add fixed art text if needed. The text block supports text content, text color, background color, opacity, font size, padding, radius, and drag/resize on canvas.
5. Export the template as JSON or ZIP.

The exported template stores page bindings and art text in `template.json`. It does not store local absolute paths.

## Export PPT Notes

Template frames decide which PPT pages are placed into which regions. For example, if a frame is bound to page `3`, the exporter will use `page_003.png` from the PPT export.

```powershell
npm run export:notes -- `
  --input "D:\path\to\ppt-folder" `
  --template "D:\path\to\template.json" `
  --output "D:\path\to\output-folder" `
  --timeout-seconds 180
```

Output format:

```text
output-folder/
  PPT file name/
    collage.png
    page_001.png
    page_002.png
    page_003.png
    ...
  summary.json
```

Behavior:

- Each PPT/PPTX gets one folder.
- PPT slides are exported as `page_###.png` at 1920x1080.
- Template outputs whose referenced page numbers exist are rendered into `collage.png`.
- If a folder already contains `page_###.png`, those files are reused and only `collage.png` is regenerated.
- Failed PPT files are recorded in `summary.json` and do not stop the batch.

## Useful Commands

```powershell
npm run dev
npm run build
npm run test
npm run smoke:render
npm run export:notes -- --help
```

## Delivery Notes

For another machine, send either:

- the repository plus a `template.json`; or
- a ZIP exported from Template Studio, which contains `template.json` and any image assets.

Then run `npm run export:notes` with the template path and the PPT folder.
