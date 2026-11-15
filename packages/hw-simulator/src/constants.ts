/** USB report size: COMM_PKT_MAX_LEN in x1_wallet_firmware usb_api_priv.h:30. */
export const FRAME_SIZE = 64;

/** The simulator bridge only ever binds to localhost. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 52640;

export const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
export const DEFAULT_CONNECT_RETRIES = 10;
export const DEFAULT_RETRY_DELAY_MS = 300;

export interface SimulatorConnectionOptions {
  /** Default 127.0.0.1, or $CYPHEROCK_SIM_HOST */
  host?: string;
  /** Default 52640, or $CYPHEROCK_SIM_PORT */
  port?: number;
  /** Per-attempt connect timeout in ms */
  connectTimeoutMs?: number;
  /** Connection attempts before failing (the simulator may still be booting) */
  retries?: number;
  /** Delay between attempts in ms */
  retryDelayMs?: number;
}
