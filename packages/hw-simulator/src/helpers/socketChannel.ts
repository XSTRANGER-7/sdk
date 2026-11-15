import net from 'net';
import * as uuid from 'uuid';
import { PoolData } from '@cypherock/sdk-interfaces';

import { FrameAccumulator, toFrames } from './framing';
import { logger } from '../logger';

export interface SocketChannelOptions {
  host: string;
  port: number;
  connectTimeoutMs: number;
  retries: number;
  retryDelayMs: number;
  frameSize: number;
}

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * TCP channel to the X1 simulator. Moves 64-byte frames only; knows nothing
 * about Cypherock packets.
 *
 * Received frames go into a pool of `PoolData` items with stable ids, the
 * same shape and semantics as hw-hid's DataListener.
 */
export class SocketChannel {
  private socket: net.Socket | undefined;

  private readonly accumulator: FrameAccumulator;

  private readonly pool: PoolData[] = [];

  private closed = true;

  private constructor(private readonly options: SocketChannelOptions) {
    this.accumulator = new FrameAccumulator(options.frameSize);
  }

  public static async open(options: SocketChannelOptions) {
    const channel = new SocketChannel(options);
    let lastError: unknown;
    for (let attempt = 1; attempt <= options.retries; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await channel.connectOnce();
        return channel;
      } catch (error) {
        lastError = error;
        logger.debug(`Simulator connect attempt ${attempt} failed`);
        if (attempt < options.retries) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(options.retryDelayMs);
        }
      }
    }
    throw lastError;
  }

  public get isOpen() {
    return !this.closed && !!this.socket && !this.socket.destroyed;
  }

  public async write(data: Uint8Array) {
    const { socket } = this;
    if (!socket || !this.isOpen) throw new Error('Simulator socket is closed');

    for (const frame of toFrames(data, this.options.frameSize)) {
      logger.debug(`tx ${hex(frame)}`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve, reject) => {
        socket.write(frame, err => (err ? reject(err) : resolve()));
      });
    }
  }

  /** Next frame or undefined, never waits (hw-hid: pool.shift()?.data). */
  public tryRead() {
    return this.pool.shift()?.data;
  }

  /** Not consumed; ids stay stable so sdk-core can skip items it has seen. */
  public peekAll(): PoolData[] {
    return this.pool.map(({ id, data }) => ({ id, data: data.slice() }));
  }

  public async close() {
    const { socket } = this;
    this.socket = undefined;
    this.closed = true;
    this.pool.length = 0;
    if (!socket || socket.destroyed) return;

    await new Promise<void>(resolve => {
      socket.once('close', () => resolve());
      socket.end();
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 200);
    });
  }

  private connectOnce() {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: this.options.host,
        port: this.options.port,
      });

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Simulator connect timeout'));
      }, this.options.connectTimeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        this.attach(socket);
        resolve();
      });

      socket.once('error', error => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      });
    });
  }

  private attach(socket: net.Socket) {
    this.socket = socket;
    this.closed = false;
    this.accumulator.reset();

    socket.on('data', (chunk: Buffer) => {
      for (const frame of this.accumulator.push(new Uint8Array(chunk))) {
        logger.debug(`rx ${hex(frame)}`);
        this.pool.push({ id: uuid.v4(), data: frame });
      }
    });

    socket.on('close', () => {
      this.closed = true;
    });

    socket.on('error', error => {
      logger.warn(`Simulator socket error: ${error.message}`);
    });
  }
}
