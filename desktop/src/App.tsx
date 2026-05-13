import { useState, useEffect, useRef } from 'react';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useAgent } from './hooks/useAgent';

type View = 'home' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('home');
  const { status, start } = useAgent();

  const startedRef = useRef(false);
  // Auto-start agent on first load if not already running
  useEffect(() => {
    if (!startedRef.current && !status.running) {
      startedRef.current = true;
      start();
    }
  }, [status.running, start]);

  if (view === 'settings') {
    return <SettingsScreen onBack={() => setView('home')} />;
  }
  return <HomeScreen onOpenSettings={() => setView('settings')} />;
}
