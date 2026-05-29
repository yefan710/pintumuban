import { describe, expect, it } from 'vitest';
import {
  addFrameToOutput,
  batchDuplicateOutput,
  createCanvasOutput,
  createFrame,
  inferBatchPageStep,
  lockFrameRatio,
  movePerspectiveFrame,
  unlockFramePerspective,
  updatePerspectiveCorner,
} from './template';

describe('addFrameToOutput', () => {
  it('keeps newly added frames inside a 3:4 canvas after the third frame', () => {
    let output = createCanvasOutput(1, '3:4');

    for (let index = 0; index < 8; index += 1) {
      output = addFrameToOutput(output).output;
    }

    for (const frame of output.frames) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.w).toBeLessThanOrEqual(output.canvas.width);
      expect(frame.y + frame.h).toBeLessThanOrEqual(output.canvas.height);
    }
  });
});

describe('batch page sequencing', () => {
  it('infers a non-overlapping page step from the selected output span', () => {
    const output = createCanvasOutput(1, '3:4');
    output.frames = [createFrame(1), createFrame(2)];

    expect(inferBatchPageStep(output)).toBe(2);
  });

  it('duplicates two-page outputs as 1/2, 3/4, 5/6 when page step is inferred', () => {
    const output = createCanvasOutput(1, '3:4');
    output.frames = [createFrame(1), createFrame(2)];
    const pageStep = inferBatchPageStep(output);
    const additions = batchDuplicateOutput(output, 2, 2, pageStep);

    expect(additions.map((item) => item.frames.map((frame) => frame.page))).toEqual([
      [3, 4],
      [5, 6],
    ]);
  });
});

describe('perspective frame helpers', () => {
  it('initializes four corners from a locked frame', () => {
    const frame = createFrame(1, 90, 120, 720);
    const unlocked = unlockFramePerspective(frame);

    expect(unlocked.transformMode).toBe('perspective');
    expect(unlocked.corners).toEqual({
      topLeft: { x: 90, y: 120 },
      topRight: { x: 810, y: 120 },
      bottomRight: { x: 810, y: 525 },
      bottomLeft: { x: 90, y: 525 },
    });
  });

  it('syncs the bounding rect when a perspective corner moves', () => {
    const frame = unlockFramePerspective(createFrame(1, 90, 120, 720));
    const updated = updatePerspectiveCorner(frame, 'topRight', { x: 860, y: 80 });

    expect(updated.x).toBe(90);
    expect(updated.y).toBe(80);
    expect(updated.w).toBe(770);
    expect(updated.h).toBe(445);
  });

  it('moves all corners when the perspective frame moves', () => {
    const frame = unlockFramePerspective(createFrame(1, 90, 120, 720));
    const moved = movePerspectiveFrame(frame, 120, 150);

    expect(moved.corners?.topLeft).toEqual({ x: 120, y: 150 });
    expect(moved.corners?.bottomRight).toEqual({ x: 840, y: 555 });
  });

  it('locks a perspective frame back to a 16:9 rect', () => {
    const frame = updatePerspectiveCorner(unlockFramePerspective(createFrame(1, 90, 120, 720)), 'topRight', { x: 860, y: 80 });
    const locked = lockFrameRatio(frame);

    expect(locked.transformMode).toBe('locked');
    expect(locked.corners).toBeUndefined();
    expect(locked.x).toBe(90);
    expect(locked.y).toBe(80);
    expect(locked.w).toBe(770);
    expect(locked.h).toBe(433);
  });
});
