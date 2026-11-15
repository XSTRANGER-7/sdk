/**
 * Fixed-size framing helpers.
 *
 * TCP is a byte stream: one write may arrive as two reads, or two writes as
 * one read. USB HID is not: it delivers whole reports. These helpers restore
 * report boundaries on top of TCP so both sides can keep USB semantics.
 */

/** Split data into frames of exactly `frameSize` bytes, zero-padding the last. */
export function toFrames(data: Uint8Array, frameSize: number): Uint8Array[] {
  if (frameSize <= 0) throw new RangeError('frameSize must be positive');
  if (data.length === 0) return [new Uint8Array(frameSize)];

  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += frameSize) {
    const frame = new Uint8Array(frameSize);
    frame.set(data.subarray(offset, Math.min(offset + frameSize, data.length)));
    frames.push(frame);
  }
  return frames;
}

/**
 * Accumulates incoming bytes and emits complete frames.
 * Partial frames stay buffered until the rest arrives.
 */
export class FrameAccumulator {
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(private readonly frameSize: number) {
    if (frameSize <= 0) throw new RangeError('frameSize must be positive');
  }

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);

    const frames: Uint8Array[] = [];
    let offset = 0;
    while (merged.length - offset >= this.frameSize) {
      frames.push(merged.slice(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    this.buffer = merged.slice(offset);
    return frames;
  }

  /** Bytes waiting for the rest of their frame. */
  get pendingBytes(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}
