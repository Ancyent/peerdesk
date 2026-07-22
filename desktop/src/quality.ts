// web/src/quality.ts
export interface QualitySettings {
  bitrate_kbps: number;
  fps: number;
  max_height: number; // 0 = native
}

export type PresetId = 'good' | 'balanced' | 'reaction' | 'custom';

export const PRESETS: Record<Exclude<PresetId, 'custom'>, QualitySettings> = {
  good:     { bitrate_kbps: 4000, fps: 30, max_height: 0 },
  balanced: { bitrate_kbps: 2000, fps: 30, max_height: 1080 },
  reaction: { bitrate_kbps: 800,  fps: 30, max_height: 720 },
};

export const DEFAULT_PRESET: PresetId = 'balanced';

export function clampCustom(fps: number, bitrate_kbps: number): QualitySettings {
  return {
    fps: Math.min(60, Math.max(1, Math.round(fps) || 30)),
    bitrate_kbps: Math.min(8000, Math.max(100, Math.round(bitrate_kbps) || 2000)),
    max_height: 0,
  };
}
