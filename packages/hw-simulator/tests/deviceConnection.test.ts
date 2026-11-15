import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import {
  DeviceConnectionError,
  DeviceConnectionErrorType,
  DeviceState,
} from '@cypherock/sdk-interfaces';
import { SDK } from '@cypherock/sdk-core';

import { DeviceConnection, FRAME_SIZE } from '../src';
import { MockDevice } from './__helpers__/mockDevice';

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/** Polls like sdk-core's waitForPacket (RECHECK_TIME = 2 ms). */
const receiveWithin = async (connection: DeviceConnection, ms = 1000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const frame = await connection.receive();
    if (frame) return frame;
    // eslint-disable-next-line no-await-in-loop
    await sleep(2);
  }
  return undefined;
};

/**
 * Bytes the X1 firmware compares an incoming report against before running
 * its v3 parser: x1_wallet_firmware usb_rx_parser.c:112-121 (SDK_REQ_PACKET).
 */
const FIRMWARE_SDK_REQ = [
  0xaa, 0x58, 0x07, 0x00, 0x01, 0x00, 0x01, 0x00, 0x45, 0x85,
];

/** Firmware's 28-byte reply: ACK + SDK version 3.0.0 (usb_rx_parser.c:122-153). */
const FIRMWARE_SDK_RESP = Uint8Array.from([
  0xaa, 0x01, 0x0a, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x12, 0x30,
  0xaa, 0x58, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00,
  0xbd, 0x90,
]);

describe('hw-simulator DeviceConnection', () => {
  let device: MockDevice;

  const connect = () =>
    DeviceConnection.create({
      port: device.port,
      retries: 3,
      retryDelayMs: 50,
    });

  beforeEach(async () => {
    device = await MockDevice.start();
  });

  afterEach(async () => {
    await device.stop();
  });

  test('reports simulator metadata', async () => {
    const connection = await connect();
    expect(await connection.isConnected()).toBe(true);
    expect(await connection.getConnectionType()).toBe('simulator');
    expect(await connection.getDeviceState()).toBe(DeviceState.MAIN);
    await connection.destroy();
    expect(await connection.isConnected()).toBe(false);
  });

  test('send pads to one 64-byte frame without a report ID', async () => {
    const connection = await connect();
    await connection.send(Uint8Array.from([0x55, 0x55, 1, 2, 3]));
    const frame = await receiveWithin(connection);
    expect(frame).toBeDefined();
    expect(frame?.length).toBe(FRAME_SIZE);
    expect(Array.from(device.received[0].subarray(0, 5))).toEqual([
      0x55, 0x55, 1, 2, 3,
    ]);
    expect(device.received[0].subarray(5).every(b => b === 0)).toBe(true);
    await connection.destroy();
  });

  test('receive returns undefined at once on an empty pool', async () => {
    const connection = await connect();
    const start = process.hrtime.bigint();
    expect(await connection.receive()).toBeUndefined();
    expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(5);
    await connection.destroy();
  });

  test('peek returns { id, data } items, stable ids, nothing consumed', async () => {
    const connection = await connect();
    await connection.send(Uint8Array.from([7]));
    await sleep(100);
    const first = await connection.peek();
    const second = await connection.peek();
    expect(first).toHaveLength(1);
    expect(typeof first[0].id).toBe('string');
    expect(first[0].data).toBeInstanceOf(Uint8Array);
    expect(first[0].id).toBe(second[0].id);
    expect((await connection.receive())?.[0]).toBe(7);
    expect(await connection.peek()).toHaveLength(0);
    await connection.destroy();
  });

  test('sequence numbers follow the hw-hid rule (+1)', async () => {
    const connection = await connect();
    expect(await connection.getNewSequenceNumber()).toBe(1);
    expect(await connection.getNewSequenceNumber()).toBe(2);
    expect(await connection.getSequenceNumber()).toBe(2);
    await connection.destroy();
  });

  test('send after the simulator disconnects throws CONNECTION_CLOSED', async () => {
    device.setHandler((_frame, control) => {
      control.disconnect();
      return undefined;
    });
    const connection = await connect();
    await connection.send(Uint8Array.from([1]));
    await sleep(150);
    expect(await connection.isConnected()).toBe(false);
    await expect(connection.send(Uint8Array.from([1]))).rejects.toMatchObject({
      code: DeviceConnectionErrorType.CONNECTION_CLOSED,
    });
    await connection.destroy();
  });

  test('create with nothing listening throws NOT_CONNECTED', async () => {
    const { port } = device;
    await device.stop();
    const error = await DeviceConnection.create({
      port,
      retries: 2,
      retryDelayMs: 10,
    }).catch(e => e);
    expect(error).toBeInstanceOf(DeviceConnectionError);
    expect(error.code).toBe(DeviceConnectionErrorType.NOT_CONNECTED);
    device = await MockDevice.start();
  });

  test('list() describes a running simulator and is empty without one', async () => {
    const found = await DeviceConnection.list({ port: device.port });
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe(`tcp://127.0.0.1:${device.port}`);
    expect(found[0].type).toBe('simulator');
    const { port } = device;
    await device.stop();
    expect(await DeviceConnection.list({ port, retryDelayMs: 10 })).toEqual([]);
    device = await MockDevice.start();
  });

  test('real sdk-core handshake: SDK.create() negotiates packet version v3', async () => {
    let requestMatchedFirmware = false;
    device.setHandler(frame => {
      if (frame[0] !== 0xaa) return [];
      requestMatchedFirmware =
        JSON.stringify(Array.from(frame.subarray(0, 10))) ===
        JSON.stringify(FIRMWARE_SDK_REQ);
      return [FIRMWARE_SDK_RESP];
    });

    const connection = await connect();
    const sdk = await SDK.create(connection, 1);

    expect(requestMatchedFirmware).toBe(true);
    expect(sdk.getVersion()).toBe('3.0.0');
    expect(sdk.getPacketVersion()).toBe('v3');
    await connection.destroy();
  });
});
