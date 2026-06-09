import type { HWH5Bridge, HWH5EXT, Pedestal } from './bridge/hwext';

interface WindowFsModule {
  promises?: {
    writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  };
  writeFile?: (path: string, data: Uint8Array, callback: (error?: Error | null) => void) => void;
}

declare global {
  interface Window {
    HWH5EXT?: HWH5EXT;
    Pedestal?: Pedestal;
    HWH5: HWH5Bridge;
    onReceive?: (schema: string, payload: string) => void;
    require?: (moduleName: 'fs' | string) => WindowFsModule;
  }
}

export {};
