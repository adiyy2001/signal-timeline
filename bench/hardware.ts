import { cpus, totalmem } from 'node:os';

export interface Hardware {
  readonly node: string;
  readonly platform: string;
  readonly cpu: string;
  readonly cores: number;
  readonly memoryGb: number;
}

export function describeHardware(): Hardware {
  const processors = cpus();
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: processors[0]?.model ?? 'unknown',
    cores: processors.length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
  };
}
