import { seededNoise } from '../lib/utils';

/**
 * Hardware profile for the reference machine (labelled as mock telemetry).
 * Phase 1 has no real sensors — values wobble deterministically per minute
 * so meters feel alive without pretending to be real measurements.
 */
export const HARDWARE_PROFILE = {
  cpu: 'Intel Core i5-8250U (4C/8T, ~15 W)',
  ramTotalGB: 20,
  storageTotalGB: 512,
  storageFreeGB: 143,
  gpu: 'Intel UHD 620 (integrated) + NVIDIA MX150 (4 GB)',
  os: 'Windows 11 25H2',
};

export interface Telemetry {
  cpuPct: number;
  ramUsedGB: number;
  gpuPct: number;
  ramTotalGB: number;
}

export function mockTelemetry(tick = 0): Telemetry {
  const seed = `${new Date().getMinutes()}-${tick}`;
  const n1 = seededNoise(`cpu-${seed}`);
  const n2 = seededNoise(`ram-${seed}`);
  const n3 = seededNoise(`gpu-${seed}`);
  return {
    cpuPct: 24 + n1 * 40,
    ramUsedGB: 7.5 + n2 * 5.5,
    gpuPct: 8 + n3 * 30,
    ramTotalGB: HARDWARE_PROFILE.ramTotalGB,
  };
}

/** 20-point history generator for sparklines, stable per key. */
export function mockSeries(key: string, base: number, amp: number, points = 20): number[] {
  return Array.from({ length: points }, (_, i) =>
    Math.max(2, base + (seededNoise(`${key}-${i}`) - 0.5) * 2 * amp),
  );
}
