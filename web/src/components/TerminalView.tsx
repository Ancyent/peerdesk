import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Props {
  channel: RTCDataChannel | null;
}

export function TerminalView({ channel }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !channel) return;
    const term = new Terminal({
      fontFamily: 'monospace', fontSize: 13, cursorBlink: true,
      theme: { background: '#0d1117' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    channel.binaryType = 'arraybuffer';
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data === 'string') term.write(e.data);
      else term.write(new Uint8Array(e.data));
    };
    channel.addEventListener('message', onMsg);

    const sendResize = () => {
      try { channel.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch { /* not open yet */ }
    };
    const dataDisp = term.onData(d => { try { channel.send(d); } catch { /* not open */ } });
    const resizeDisp = term.onResize(() => sendResize());
    const onWinResize = () => fit.fit();
    window.addEventListener('resize', onWinResize);
    if (channel.readyState === 'open') sendResize();
    else channel.addEventListener('open', sendResize, { once: true });

    return () => {
      channel.removeEventListener('message', onMsg);
      window.removeEventListener('resize', onWinResize);
      dataDisp.dispose();
      resizeDisp.dispose();
      term.dispose();
    };
  }, [channel]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', background: '#0d1117' }} />;
}
