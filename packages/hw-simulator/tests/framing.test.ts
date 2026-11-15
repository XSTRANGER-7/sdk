import { describe, expect, test } from '@jest/globals';

import { FrameAccumulator, toFrames } from '../src/helpers/framing';

describe('framing', () => {
  test('toFrames pads a short payload to one full frame', () => {
    const frames = toFrames(Uint8Array.from([1, 2, 3]), 8);
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0])).toEqual([1, 2, 3, 0, 0, 0, 0, 0]);
  });

  test('toFrames splits a long payload and pads the last frame', () => {
    const data = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
    const frames = toFrames(data, 8);
    expect(frames).toHaveLength(3);
    expect(Array.from(frames[2])).toEqual([17, 18, 19, 20, 0, 0, 0, 0]);
  });

  test('toFrames rejects a non-positive frame size', () => {
    expect(() => toFrames(Uint8Array.from([1]), 0)).toThrow(RangeError);
  });

  test('FrameAccumulator rebuilds a frame split across TCP chunks', () => {
    const acc = new FrameAccumulator(4);
    expect(acc.push(Uint8Array.from([1, 2]))).toHaveLength(0);
    expect(acc.pendingBytes).toBe(2);
    const frames = acc.push(Uint8Array.from([3, 4, 5]));
    expect(frames.map(f => Array.from(f))).toEqual([[1, 2, 3, 4]]);
    expect(acc.pendingBytes).toBe(1);
  });

  test('FrameAccumulator emits several frames from one chunk', () => {
    const acc = new FrameAccumulator(2);
    const frames = acc.push(Uint8Array.from([1, 2, 3, 4]));
    expect(frames.map(f => Array.from(f))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
