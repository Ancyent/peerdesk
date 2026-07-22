import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAgent } from '../hooks/useAgent';
import { useSettings } from '../hooks/useSettings';
import i18n, { resolveLanguage } from '../i18n';

type AgentValue = ReturnType<typeof useAgent>;
type SettingsValue = ReturnType<typeof useSettings>;

const AgentContext = createContext<AgentValue | null>(null);
const SettingsContext = createContext<SettingsValue | null>(null);

/**
 * Single shared instance of the agent + settings hooks for the whole app.
 * Lifting these into context avoids 3-4 redundant get_agent_status polls and
 * keeps every screen in sync (e.g. HomeScreen reflects access_mode changes
 * made in Settings immediately).
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const agent = useAgent();
  const settings = useSettings();

  // Apply the persisted language once settings finish loading. Runs a single
  // time per load (not on every settings change) so the switcher — which
  // already calls i18n.changeLanguage itself — doesn't trigger a redundant
  // second change here.
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!settings.loaded || appliedRef.current) return;
    appliedRef.current = true;
    const resolved = resolveLanguage(settings.settings.language);
    if (resolved !== i18n.language) i18n.changeLanguage(resolved);
  }, [settings.loaded, settings.settings.language]);

  return (
    <AgentContext.Provider value={agent}>
      <SettingsContext.Provider value={settings}>
        {children}
      </SettingsContext.Provider>
    </AgentContext.Provider>
  );
}

export function useAgentContext(): AgentValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgentContext must be used within an AppProvider');
  return ctx;
}

export function useSettingsContext(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettingsContext must be used within an AppProvider');
  return ctx;
}
