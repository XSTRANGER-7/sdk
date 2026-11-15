/* eslint-disable class-methods-use-this */
import {
  ConnectionTypeMap,
  DeviceConnectionError,
  DeviceConnectionErrorType,
  DeviceState,
  IDevice,
  IDeviceConnection,
} from '@cypherock/sdk-interfaces';

import {
  DEFAULT_CONNECT_RETRIES,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_RETRY_DELAY_MS,
  FRAME_SIZE,
  SimulatorConnectionOptions,
} from './constants';
import { SocketChannel } from './helpers';
import { logger } from './logger';

/**
 * Drop-in replacement for @cypherock/sdk-hw-hid's DeviceConnection that talks
 * to the X1 firmware simulator over TCP (127.0.0.1:52640) instead of USB.
 *
 *   const connection = await DeviceConnection.create();
 *   const manager = await ManagerApp.create(connection);   // unchanged
 *
 * Methods mirror packages/hw-hid/src/deviceConnection.ts; differences are
 * commented.
 */
export default class DeviceConnection implements IDeviceConnection {
  protected sequenceNumber = 0;

  private readonly channel: SocketChannel;

  private readonly device: IDevice;

  private constructor(channel: SocketChannel, device: IDevice) {
    this.channel = channel;
    this.device = device;
  }

  public static async create(options: SimulatorConnectionOptions = {}) {
    const host = options.host ?? process.env.CYPHEROCK_SIM_HOST ?? DEFAULT_HOST;
    const port =
      options.port ?? Number(process.env.CYPHEROCK_SIM_PORT ?? DEFAULT_PORT);

    try {
      const channel = await SocketChannel.open({
        host,
        port,
        connectTimeoutMs:
          options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        retries: options.retries ?? DEFAULT_CONNECT_RETRIES,
        retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
        frameSize: FRAME_SIZE,
      });
      return new DeviceConnection(
        channel,
        DeviceConnection.describe(host, port),
      );
    } catch (error) {
      logger.warn(`No X1 simulator listening at ${host}:${port}`);
      throw new DeviceConnectionError(DeviceConnectionErrorType.NOT_CONNECTED);
    }
  }

  /** Same idea as hw-hid's list(): one entry if a simulator answers. */
  public static async list(options: SimulatorConnectionOptions = {}) {
    try {
      const probe = await DeviceConnection.create({ ...options, retries: 1 });
      const { device } = probe;
      await probe.destroy();
      return [device];
    } catch {
      return [];
    }
  }

  private static describe(host: string, port: number): IDevice {
    return {
      path: `tcp://${host}:${port}`,
      // The simulator is built with FIRMWARE_TYPE=Main (no bootloader)
      deviceState: DeviceState.MAIN,
      // Same ids hw-hid filters on (helpers/connection.ts)
      vendorId: 0x3503,
      productId: 0x0103,
      serial: 'SIMULATOR',
      type: ConnectionTypeMap.SIMULATOR,
    };
  }

  public async getConnectionType() {
    return ConnectionTypeMap.SIMULATOR;
  }

  public async isConnected() {
    return this.channel.isOpen;
  }

  /**
   * hw-hid starts its read loop here and stops it in afterOperation(). The
   * socket is always read; frames that arrive between operations wait in the
   * pool, like unread HID reports wait in the OS buffer.
   */
  public async beforeOperation() {
    // Nothing to do, see above
  }

  public async afterOperation() {
    // Nothing to do, see beforeOperation
  }

  public async getSequenceNumber() {
    return this.sequenceNumber;
  }

  /** Same rule as hw-hid: increment, no wrap. */
  public async getNewSequenceNumber() {
    this.sequenceNumber += 1;
    return this.sequenceNumber;
  }

  public async getDeviceState() {
    return this.device.deviceState;
  }

  /**
   * hw-hid writes a 0x00 report ID plus the data padded to 64 bytes. The
   * device's USB stack strips the report ID before the firmware parser sees
   * it, so only the 64-byte report goes over TCP.
   */
  public async send(data: Uint8Array) {
    if (!this.channel.isOpen) {
      throw new DeviceConnectionError(
        DeviceConnectionErrorType.CONNECTION_CLOSED,
      );
    }
    await this.channel.write(data);
  }

  /** Next frame from the simulator, or undefined at once. */
  public async receive() {
    return this.channel.tryRead();
  }

  /** Pooled frames as { id, data }, not consumed. */
  public async peek() {
    return this.channel.peekAll();
  }

  public async destroy() {
    await this.channel.close();
  }
}
