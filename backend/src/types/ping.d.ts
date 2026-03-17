declare module 'ping' {
  export interface PingConfig {
    timeout?: number;
    min_reply?: number;
    v6?: boolean;
  }

  export interface PingResponse {
    host: string;
    alive: boolean;
    output: string;
    time: number | string;
    min: string;
    max: string;
    avg: string;
    packetLoss: string;
    stddev: string;
  }

  export const promise: {
    probe: (host: string, config?: PingConfig) => Promise<PingResponse>;
  };

  export const sys: {
    probe: (host: string, callback: (isAlive: boolean, error?: Error) => void, config?: PingConfig) => void;
  };
}
