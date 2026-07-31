import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { api } from '../api/client';
import { localizeError } from '../api/errors';
import { applyBranding } from '../hooks/useBranding';
import { InlineError, useNotify } from '@pd/ui';

interface Props {
  onBack: () => void;
}

export function BrandingPage({ onBack }: Props) {
  const { t } = useTranslation('branding');
  const { accessToken } = useAuth();
  const { notify } = useNotify();
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
      // A failed load silently falls back to the built-in defaults shown
      // above, which an admin who has actually customized branding could
      // mistake for "branding was reset" and then overwrite by hitting Save.
      .catch((e) => notify.error(t('notify:branding.loadFailed'), { detail: localizeError(e) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError(t('branding:errors.logoTooLarge'));
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
        logo_data_url: logoDataUrl,
      });
      applyBranding(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('branding:errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!accessToken) return;
    const defaults = { brand_name: 'PeerDesk', accent_color: '#2563eb', logo_data_url: null };
    try {
      await api.branding.update(accessToken, defaults);
      // Only reflect the reset locally once the server has actually accepted
      // it -- otherwise the form would show defaults while the server still
      // has the old branding, and the admin would have no way of knowing.
      setBrandName('PeerDesk');
      setAccentColor('#2563eb');
      setLogoDataUrl(null);
      applyBranding({ brand_name: 'PeerDesk', logo_data_url: null, accent_color: '#2563eb' });
      notify.success(t('notify:branding.reset'));
    } catch (e) {
      notify.error(t('notify:branding.resetFailed'), { detail: localizeError(e) });
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: 14, borderRadius: 6,
    border: '1px solid var(--border-dim)', width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-surface)', color: 'var(--text-1)',
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 600, margin: '0 auto', padding: '24px 16px', background: 'var(--bg-base)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid var(--border-dim)' }}>
        <button onClick={onBack} title={t('branding:back')} aria-label={t('branding:back')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text-1)' }}>{t('branding:title')}</h1>
      </div>

      {error && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          <InlineError>{error}</InlineError>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Logo */}
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-2)' }}>
            {t('branding:logo.label')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoDataUrl && (
              <div style={{ border: '1px solid var(--border-dim)', borderRadius: 6, padding: 6, background: 'var(--bg-surface)' }}>
                <img src={logoDataUrl} alt={t('branding:logo.previewAlt')} style={{ height: 36, objectFit: 'contain', display: 'block' }} />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
            <button onClick={() => fileRef.current?.click()}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-dim)', background: 'var(--bg-hover)', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>
              {logoDataUrl ? t('branding:logo.change') : t('branding:logo.upload')}
            </button>
            {logoDataUrl && (
              <button onClick={() => setLogoDataUrl(null)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', cursor: 'pointer', fontSize: 13 }}>
                {t('branding:logo.remove')}
              </button>
            )}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-3)' }}>{t('branding:logo.hint')}</p>
        </div>

        {/* Brand name */}
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-2)' }}>
            {t('branding:brandName.label')}
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
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-2)' }}>
            {t('branding:accentColor.label')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="color"
              value={accentColor}
              onChange={e => setAccentColor(e.target.value)}
              style={{ width: 44, height: 38, borderRadius: 6, border: '1px solid var(--border-dim)', cursor: 'pointer', padding: 2 }}
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
        <div style={{ border: '1px solid var(--border-dim)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-dim)' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>{t('branding:preview.label')}</span>
          </div>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, background: 'var(--bg-hover)' }}>
            {logoDataUrl ? (
              <img src={logoDataUrl} alt={t('branding:logo.alt')} style={{ height: 44, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1)' }}>{brandName || 'PeerDesk'}</span>
            )}
            <button style={{
              padding: '10px 24px', background: accentColor, color: 'var(--text-1)',
              border: 'none', borderRadius: 6, fontSize: 15, cursor: 'default', fontWeight: 500,
            }}>
              {t('branding:preview.connect')}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1, padding: '10px 0', background: 'var(--accent)', color: 'var(--accent-ink)',
              border: 'none', borderRadius: 6, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 500, opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? t('branding:actions.saving') : saved ? t('branding:actions.saved') : t('branding:actions.save')}
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '10px 18px', background: 'var(--bg-hover)', color: 'var(--text-2)',
              border: '1px solid var(--border-dim)', borderRadius: 6, fontSize: 14, cursor: 'pointer',
            }}
          >
            {t('branding:actions.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
