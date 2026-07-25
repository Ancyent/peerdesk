import { describe, it, expect } from 'vitest';
import {
  emptyToastState, addToast, dismissToast, tickToasts,
  MAX_VISIBLE, DEFAULT_DURATION_MS,
} from '@pd/ui';

describe('toastStore', () => {
  it('adds a toast to the visible list', () => {
    const s = addToast(emptyToastState(), { kind: 'success', message: 'Saved' });
    expect(s.visible).toHaveLength(1);
    expect(s.visible[0].message).toBe('Saved');
    expect(s.visible[0].count).toBe(1);
  });

  it('assigns unique ids', () => {
    let s = emptyToastState();
    s = addToast(s, { kind: 'info', message: 'a' });
    s = addToast(s, { kind: 'info', message: 'b' });
    expect(s.visible[0].id).not.toBe(s.visible[1].id);
  });

  it('dismisses by id', () => {
    let s = addToast(emptyToastState(), { kind: 'info', message: 'a' });
    s = dismissToast(s, s.visible[0].id);
    expect(s.visible).toHaveLength(0);
  });

  it('auto-expires a success toast after its duration', () => {
    let s = addToast(emptyToastState(), { kind: 'success', message: 'Saved' });
    s = tickToasts(s, DEFAULT_DURATION_MS.success - 1);
    expect(s.visible).toHaveLength(1);
    s = tickToasts(s, 1);
    expect(s.visible).toHaveLength(0);
  });

  it('never auto-expires an error toast', () => {
    let s = addToast(emptyToastState(), { kind: 'error', message: 'Boom' });
    s = tickToasts(s, 600_000);
    expect(s.visible).toHaveLength(1);
    s = dismissToast(s, s.visible[0].id);
    expect(s.visible).toHaveLength(0);
  });

  it('dedups an identical message inside the window by incrementing count', () => {
    let s = addToast(emptyToastState(), { kind: 'error', message: 'Boom' });
    s = addToast(s, { kind: 'error', message: 'Boom' });
    expect(s.visible).toHaveLength(1);
    expect(s.visible[0].count).toBe(2);
  });

  it('does not dedup a different kind with the same message', () => {
    let s = addToast(emptyToastState(), { kind: 'error', message: 'Boom' });
    s = addToast(s, { kind: 'info', message: 'Boom' });
    expect(s.visible).toHaveLength(2);
  });

  it('does not dedup once the window has passed', () => {
    let s = addToast(emptyToastState(), { kind: 'error', message: 'Boom' });
    s = tickToasts(s, 3001);
    s = addToast(s, { kind: 'error', message: 'Boom' });
    expect(s.visible).toHaveLength(2);
  });

  it('queues beyond MAX_VISIBLE instead of discarding', () => {
    let s = emptyToastState();
    for (let i = 0; i < MAX_VISIBLE + 2; i++) {
      s = addToast(s, { kind: 'info', message: `m${i}` });
    }
    expect(s.visible).toHaveLength(MAX_VISIBLE);
    expect(s.queued).toHaveLength(2);
  });

  it('promotes a queued toast when a visible slot frees up', () => {
    let s = emptyToastState();
    for (let i = 0; i < MAX_VISIBLE + 1; i++) {
      s = addToast(s, { kind: 'info', message: `m${i}` });
    }
    s = dismissToast(s, s.visible[0].id);
    expect(s.visible).toHaveLength(MAX_VISIBLE);
    expect(s.queued).toHaveLength(0);
    expect(s.visible[MAX_VISIBLE - 1].message).toBe(`m${MAX_VISIBLE}`);
  });

  it('does not age queued toasts — their timer starts when they become visible', () => {
    let s = emptyToastState();
    for (let i = 0; i < MAX_VISIBLE + 1; i++) {
      s = addToast(s, { kind: 'success', message: `m${i}` });
    }
    s = tickToasts(s, DEFAULT_DURATION_MS.success);
    expect(s.visible).toHaveLength(1);
    expect(s.visible[0].message).toBe(`m${MAX_VISIBLE}`);
    expect(s.visible[0].remainingMs).toBe(DEFAULT_DURATION_MS.success);
  });

  it('honours an explicit durationMs override', () => {
    let s = addToast(emptyToastState(), { kind: 'info', message: 'a', durationMs: 100 });
    s = tickToasts(s, 100);
    expect(s.visible).toHaveLength(0);
  });
});
