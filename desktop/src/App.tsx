import { useState, useEffect } from 'react';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useAgent } from './hooks/useAgent';

type View = 'home' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('home');
  const { status, start } = useAgent();

  // Auto-start agent on first load if not already running
  useEffect(() => {
    if (!status.running && status.peer_id === '') {
      start();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'settings') {
    return <SettingsScreen onBack={() => setView('home')} />;
  }
  return <HomeScreen onOpenSettings={() => setView('settings')} />;
}
