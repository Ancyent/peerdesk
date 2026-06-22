import { useState } from 'react';
import { PRESETS, PRESET_LABELS, clampCustom, type PresetId, type QualitySettings } from '../quality';

export function QualitySelector({ onChange }: { onChange: (q: QualitySettings) => void }) {
  const [preset, setPreset] = useState<PresetId>('balanced');
  const [fps, setFps] = useState(30);
  const [kbps, setKbps] = useState(2000);
  const apply = (p: PresetId, f = fps, k = kbps) => {
    onChange(p === 'custom' ? clampCustom(f, k) : PRESETS[p]);
  };
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <select value={preset} onChange={(e) => { const p = e.target.value as PresetId; setPreset(p); apply(p); }}>
        {(Object.keys(PRESET_LABELS) as PresetId[]).map((id) => (
          <option key={id} value={id}>{PRESET_LABELS[id]}</option>
        ))}
      </select>
      {preset === 'custom' && (
        <>
          <label>FPS <input type="number" min={1} max={60} value={fps}
            onChange={(e) => { const f = +e.target.value; setFps(f); apply('custom', f, kbps); }} style={{ width: 56 }} /></label>
          <label>kbps <input type="number" min={100} max={8000} step={100} value={kbps}
            onChange={(e) => { const k = +e.target.value; setKbps(k); apply('custom', fps, k); }} style={{ width: 72 }} /></label>
        </>
      )}
    </span>
  );
}
