# @cypherock/sdk-hw-simulator

Connects the Cypherock SDK to the **X1 firmware simulator** over a localhost TCP socket, so SDK apps run against real firmware code without an X1 device.

It is a drop-in replacement for `@cypherock/sdk-hw-hid`'s `DeviceConnection`:

```ts
import { DeviceConnection } from '@cypherock/sdk-hw-simulator';
import { ManagerApp } from '@cypherock/sdk-app-manager';

const connection = await DeviceConnection.create(); // 127.0.0.1:52640
const manager = await ManagerApp.create(connection);
console.log(await manager.getDeviceInfo());
```

## Requirements

A simulator built from `x1_wallet_firmware` with the TCP bridge (`simulator/transport`), listening on `127.0.0.1:52640`. Build and run instructions: <https://github.com/XSTRANGER-7/cypherock-simulator-bridge>.

## Options

| Option             | Default     | Env var              |
| ------------------ | ----------- | -------------------- |
| `host`             | `127.0.0.1` | `CYPHEROCK_SIM_HOST` |
| `port`             | `52640`     | `CYPHEROCK_SIM_PORT` |
| `connectTimeoutMs` | `3000`      |                      |
| `retries`          | `10`        |                      |
| `retryDelayMs`     | `300`       |                      |

## Wire format

Fixed 64-byte frames, one per USB report. `send()` writes each packet zero-padded to 64 bytes; the HID report ID that `hw-hid` adds for node-hid is not sent, because the firmware never sees it on real USB. `receive()` returns the next frame or `undefined` immediately; `peek()` returns `{ id, data }` items without consuming them.

## Safety

For development and testing only. The simulator binds to localhost; never use it with real funds or a real seed phrase.
