import net from 'net';

import { FrameAccumulator, toFrames } from '../../src/helpers/framing';
import { FRAME_SIZE } from '../../src/constants';

/**
 * A TCP server that behaves like the patched simulator at the byte level:
 * fixed 64-byte frames on 127.0.0.1. It does not implement the Cypherock
 * protocol; a handler decides what to answer for each frame.
 */
export interface MockControl {
  disconnect(): void;
}

/** Returns the reply payloads for a frame; anything else means no reply. */
export type FrameHandler = (
  frame: Uint8Array,
  control: MockControl,
) => Uint8Array[] | undefined;

export const echoHandler: FrameHandler = frame => [frame];

export class MockDevice {
  public readonly received: Uint8Array[] = [];

  private readonly server: net.Server;

  private readonly clients = new Set<net.Socket>();

  private handler: FrameHandler = echoHandler;

  private constructor() {
    this.server = net.createServer(socket => this.onClient(socket));
  }

  public static async start(): Promise<MockDevice> {
    const device = new MockDevice();
    await new Promise<void>((resolve, reject) => {
      device.server.once('error', reject);
      device.server.listen(0, '127.0.0.1', () => resolve());
    });
    return device;
  }

  public get port(): number {
    const address = this.server.address();
    if (address && typeof address === 'object') return address.port;
    throw new Error('MockDevice is not listening');
  }

  public setHandler(handler: FrameHandler) {
    this.handler = handler;
  }

  public async stop() {
    for (const client of this.clients) client.destroy();
    await new Promise<void>(resolve => {
      this.server.close(() => resolve());
    });
  }

  private onClient(socket: net.Socket) {
    this.clients.add(socket);
    socket.setNoDelay(true);
    const accumulator = new FrameAccumulator(FRAME_SIZE);
    const control: MockControl = { disconnect: () => socket.destroy() };

    socket.on('data', (chunk: Buffer) => {
      for (const frame of accumulator.push(new Uint8Array(chunk))) {
        this.received.push(frame);
        const result = this.handler(frame, control);
        const replies = Array.isArray(result) ? result : [];
        for (const reply of replies) {
          for (const out of toFrames(reply, FRAME_SIZE)) socket.write(out);
        }
      }
    });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => undefined);
  }
}
