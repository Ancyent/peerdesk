import { useEffect, useRef } from 'react';
import type { MachineOut } from '../api/client';

interface Options {
  /** True once the route is /viewer/<id> and the user is signed in. */
  enabled: boolean;
  machineId: string | null;
  fetchMachine: (machineId: string) => Promise<MachineOut>;
  onMachine: (machine: MachineOut) => void;
  onNotFound: () => void;
}

/**
 * Starts a session from a `/viewer/<machine-id>` address — the only way a new
 * window can land in one, since nothing else in the app reacts to that path.
 *
 * Resolves at most once per machine id. The callbacks are read through refs
 * because App rebuilds them on every render, and an effect that depended on
 * them would re-fire and join the same session again and again.
 */
export function useViewerDeepLink({
  enabled, machineId, fetchMachine, onMachine, onNotFound,
}: Options): void {
  const resolvedRef = useRef<string | null>(null);
  const fetchRef = useRef(fetchMachine);
  const onMachineRef = useRef(onMachine);
  const onNotFoundRef = useRef(onNotFound);

  // Keep the refs current without touching them during render (writing to a
  // ref's `current` in the render body itself trips the lint rule that flags
  // ref mutation during render); a dep-less effect runs after every commit,
  // still ahead of the resolve effect below in the same pass.
  useEffect(() => {
    fetchRef.current = fetchMachine;
    onMachineRef.current = onMachine;
    onNotFoundRef.current = onNotFound;
  });

  useEffect(() => {
    if (!enabled || !machineId) return;
    if (resolvedRef.current === machineId) return;
    resolvedRef.current = machineId;

    // No `cancelled` flag here: StrictMode's dev double-invoke runs this
    // effect, cleans it up, then runs it again for the same machine id. A
    // `cancelled` local set in the first run's cleanup would suppress the
    // still-in-flight fetch's callbacks forever, since the guard above skips
    // starting a second fetch. Gating on `resolvedRef` instead survives the
    // remount: it is only ever pointed at the current machine id, so a stale
    // response for an id the resolver has since moved past is still dropped.
    fetchRef.current(machineId)
      .then(m => { if (resolvedRef.current === machineId) onMachineRef.current(m); })
      .catch(() => { if (resolvedRef.current === machineId) onNotFoundRef.current(); });
  }, [enabled, machineId]);
}
