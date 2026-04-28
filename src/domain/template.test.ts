import { describe, expect, it } from 'vitest';
import { addFrameToOutput, createCanvasOutput } from './template';

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
