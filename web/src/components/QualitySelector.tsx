import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PRESETS, clampCustom, type PresetId, type QualitySettings } from '../quality';

const IDS: PresetId[] = ['good', 'balanced', 'reaction', 'custom'];

/** Quality preset menu (used inside the toolbar "Quality" dropdown). Styled to
 *  match the app's dark theme with explicit colors so it also works in the
 *  desktop client, which doesn't define the web CSS variables. */
export function QualitySelector({ onChange }: { onChange: (q: QualitySettings) => void }) {
  const { t } = useTranslation('viewer');
  const [preset, setPreset] = useState<PresetId>('balanced');
  const [fps, setFps] = useState(30);
  const [kbps, setKbps] = useState(2000);

  const apply = (p: PresetId, f = fps, k = kbps) =>
    onChange(p === 'custom' ? clampCustom(f, k) : PRESETS[p]);

  const row = (active: boolean): CSSProperties => ({
    textAlign: 'left',
    padding: '7px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: active ? 'rgba(38,198,218,0.15)' : 'transparent',
    color: active ? '#26c6da' : '#c9d3e0',
    border: `1px solid ${active ? 'rgba(38,198,218,0.4)' : 'transparent'}`,
    width: '100%',
    whiteSpace: 'nowrap',
    font: 'inherit',
  });
  const inp: CSSProperties = {
    background: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '5px 8px',
    fontSize: 12,
    color: '#e6ebf1',
    width: 70,
    outline: 'none',
  };
  const lbl: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: 11,
    color: '#93a0b2',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 188 }}>
      {IDS.map((id) => (
        <button
          key={id}
          style={row(preset === id)}
          onClick={() => {
            setPreset(id);
            apply(id);
          }}
        >
          {t('viewer:quality.presets.' + id)}
        </button>
      ))}
      {preset === 'custom' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            marginTop: 6,
            paddingTop: 9,
            borderTop: '1px solid #21262d',
          }}
        >
          <label style={lbl}>
            FPS
            <input
              type="number"
              min={1}
              max={60}
              value={fps}
              style={inp}
              onChange={(e) => {
                const f = +e.target.value;
                setFps(f);
                apply('custom', f, kbps);
              }}
            />
          </label>
          <label style={lbl}>
            Bitrate (kbps)
            <input
              type="number"
              min={100}
              max={8000}
              step={100}
              value={kbps}
              style={inp}
              onChange={(e) => {
                const k = +e.target.value;
                setKbps(k);
                apply('custom', fps, k);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
