import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { api } from '../api/client';
import { applyBranding } from '../hooks/useBranding';

interface Props {
  onBack: () => void;
}

export function BrandingPage({ onBack }: Props) {
  const { accessToken } = useAuth();
  const [brandName, setBrandName] = useState('PeerDesk');
  const [accentColor, setAccentColor] = useState('#2563eb');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.branding.get()
      .then(b => {
        setBrandName(b.brand_name);
        setAccentColor(b.accent_color);
        setLogoDataUrl(b.logo_data_url);
      })
      .catch(() => {});
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError('Logo must be under 512 KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(reader.result as string);
    reader.readAsDataURL(file);
    setError('');
  };

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await api.branding.update(accessToken, {
        brand_name: brandName,
        accent_color: accentColor,
        logo_data_url: logoDataUrl ?? '',
      });
      applyBranding(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!accessToken) return;
    const defaults = { brand_name: 'PeerDesk', accent_color: '#2563eb', logo_data_url: '' };
    await api.branding.update(accessToken, defaults).catch(() => {});
    setBrandName('PeerDesk');
    setAccentColor('#2563eb');
    setLogoDataUrl(null);
    applyBranding({ brand_name: 'PeerDesk', logo_data_url: null, accent_color: '#2563eb' });
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: 14, borderRadius: 6,
    border: '1px solid #d1d5db', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Branding</h1>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#b91c1c', fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Logo */}
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: '#374151' }}>
            Logo
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoDataUrl && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 6, background: '#f9fafb' }}>
                <img src={logoDataUrl} alt="logo preview" style={{ height: 36, objectFit: 'contain', display: 'block' }} />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
            <button onClick={() => fileRef.current?.click()}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              {logoDataUrl ? 'Change Logo' : 'Upload Logo'}
            </button>
            {logoDataUrl && (
              <button onClick={() => setLogoDataUrl(null)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>
                Remove
              </button>
            )}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>PNG, JPG, or SVG. Max 512 KB.</p>
        </div>

        {/* Brand name */}
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: '#374151' }}>
            Brand Name
          </label>
          <input
            type="text"
            value={brandName}
            onChange={e => setBrandName(e.target.value)}
            placeholder="PeerDesk"
            style={inputStyle}
            maxLength={100}
          />
        </div>

        {/* Accent color */}
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: '#374151' }}>
            Accent Color
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="color"
              value={accentColor}
              onChange={e => setAccentColor(e.target.value)}
              style={{ width: 44, height: 38, borderRadius: 6, border: '1px solid #d1d5db', cursor: 'pointer', padding: 2 }}
            />
            <input
              type="text"
              value={accentColor}
              onChange={e => setAccentColor(e.target.value)}
              placeholder="#2563eb"
              style={{ ...inputStyle, width: 120, fontFamily: 'monospace', fontSize: 13 }}
              maxLength={7}
            />
          </div>
        </div>

        {/* Live preview */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>Live Preview</span>
          </div>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, background: '#fff' }}>
            {logoDataUrl ? (
              <img src={logoDataUrl} alt="logo" style={{ height: 44, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{brandName || 'PeerDesk'}</span>
            )}
            <button style={{
              padding: '10px 24px', background: accentColor, color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 15, cursor: 'default', fontWeight: 500,
            }}>
              Connect
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1, padding: '10px 0', background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 500, opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Branding'}
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '10px 18px', background: '#fff', color: '#6b7280',
              border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer',
            }}
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}
