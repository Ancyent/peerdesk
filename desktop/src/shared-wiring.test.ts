// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { SHARED_UI_VERSION } from '@pd/ui';

describe('shared/ui wiring', () => {
  it('resolves the @pd/ui alias from the desktop app', () => {
    expect(SHARED_UI_VERSION).toBe(1);
  });
});
