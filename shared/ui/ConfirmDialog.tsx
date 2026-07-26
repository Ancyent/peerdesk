import { useId } from 'react';
import { Modal } from './Modal';
import type { Tone } from './types';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** 'danger' styles the primary action destructively and focuses Cancel first. */
  tone?: Tone;
}

interface Props {
  open: boolean;
  options: ConfirmOptions;
  onSettle: (accepted: boolean) => void;
}

export function ConfirmDialog({ open, options, onSettle }: Props) {
  const titleId = useId();
  const danger = options.tone === 'danger';

  return (
    <Modal
      open={open}
      onClose={() => onSettle(false)}
      labelledBy={titleId}
      initialFocus={danger ? 'first' : 'last'}
    >
      <div id={titleId} style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1, #fff)', marginBottom: 8 }}>
        {options.title}
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-2, #bccadb)', marginBottom: 20, lineHeight: 1.55 }}>
        {options.message}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          data-testid="confirm-cancel"
          onClick={() => onSettle(false)}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 7,
            border: '1px solid var(--border, rgba(0,200,150,0.20))',
            background: 'transparent', color: 'var(--text-2, #bccadb)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {options.cancelLabel}
        </button>

        <button
          data-testid="confirm-accept"
          onClick={() => onSettle(true)}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 7, border: 'none',
            background: danger ? 'var(--red, #f87171)' : 'var(--accent, #00c896)',
            color: '#0d1117', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {options.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
