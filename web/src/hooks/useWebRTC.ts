// web/src/hooks/useWebRTC.ts
import { useCallback, useRef, useState } from 'react';
import type { SignalingMessage } from '../types/messages';
import { api } from '../api/client';
import { getTokens } from '../auth/tokenStore';

export function useWebRTC(
  sendSignaling: (msg: SignalingMessage) => void,
  onClipboardFromAgent?: (text: string) => void
) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const inputChRef = useRef<RTCDataChannel | null>(null);
  const clipboardChRef = useRef<RTCDataChannel | null>(null);
  const ftChRef = useRef<RTCDataChannel | null>(null);
  const controlChRef = useRef<RTCDataChannel | null>(null);
  const cursorChRef = useRef<RTCDataChannel | null>(null);
  const terminalChRef = useRef<RTCDataChannel | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const sendSignalingRef = useRef(sendSignaling);
  sendSignalingRef.current = sendSignaling;
  const onClipboardRef = useRef(onClipboardFromAgent);
  onClipboardRef.current = onClipboardFromAgent;

  const startOffer = useCallback(async () => {
    // Close any existing connection before creating a new one
    pcRef.current?.close();
    inputChRef.current = null;
    clipboardChRef.current = null;
    ftChRef.current = null;
    controlChRef.current = null;
    cursorChRef.current = null;
    terminalChRef.current = null;
    setStream(null);
    setCursor(null);

    // Fetch TURN/STUN config from the server so media can traverse NAT and
    // different subnets. Without a relay, peers on different networks complete
    // signaling/DTLS but no media flows → black screen. Fall back to public
    // STUN if the request fails (e.g. not logged in).
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      const token = getTokens()?.access;
      if (token) {
        const t = await api.turn.credentials(token);
        const stun = t.urls.filter((u) => u.startsWith('stun:'));
        const turn = t.urls.filter((u) => u.startsWith('turn:'));
        iceServers = [];
        if (stun.length) iceServers.push({ urls: stun });
        if (turn.length) iceServers.push({ urls: turn, username: t.username, credential: t.credential });
      }
    } catch (e) {
      console.warn('TURN credentials unavailable, using public STUN only', e);
    }

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    inputChRef.current = pc.createDataChannel('input', { ordered: true });

    const clipboardCh = pc.createDataChannel('clipboard', { ordered: true });
    clipboardChRef.current = clipboardCh;
    clipboardCh.onmessage = (e) => {
      onClipboardRef.current?.(e.data as string);
    };

    const ftCh = pc.createDataChannel('filetransfer', { ordered: true });
    ftChRef.current = ftCh;

    const controlCh = pc.createDataChannel('control', { ordered: true });
    controlChRef.current = controlCh;

    const cursorCh = pc.createDataChannel('cursor', { ordered: false, maxRetransmits: 0 });
    cursorChRef.current = cursorCh;
    cursorCh.onmessage = (e) => {
      try { const p = JSON.parse(e.data as string); if (typeof p.x === 'number') setCursor({ x: p.x, y: p.y }); }
      catch { /* ignore */ }
    };

    const terminalCh = pc.createDataChannel('terminal', { ordered: true });
    terminalChRef.current = terminalCh;

    pc.ontrack = (e) => {
      if (e.streams[0]) setStream(e.streams[0]);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignalingRef.current({
          type: 'ice_candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    pc.createOffer({ offerToReceiveVideo: true }).then(async (offer) => {
      await pc.setLocalDescription(offer);
      if (offer.sdp) {
        sendSignalingRef.current({ type: 'offer', sdp: offer.sdp });
      }
    });
  }, []);

  const handleAnswer = useCallback(async (sdp: string) => {
    await pcRef.current?.setRemoteDescription({ type: 'answer', sdp });
  }, []);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    await pcRef.current?.addIceCandidate(candidate);
  }, []);

  const sendInput = useCallback((event: object) => {
    const ch = inputChRef.current;
    if (ch?.readyState === 'open') {
      ch.send(JSON.stringify(event));
    }
  }, []);

  const sendClipboard = useCallback((text: string) => {
    const ch = clipboardChRef.current;
    if (ch?.readyState === 'open') ch.send(text);
  }, []);

  const setQuality = useCallback((q: { bitrate_kbps: number; fps: number; max_height: number }) => {
    const ch = controlChRef.current;
    const msg = JSON.stringify({ type: 'set_quality', ...q });
    if (ch?.readyState === 'open') ch.send(msg);
    else if (ch) ch.addEventListener('open', () => ch.send(msg), { once: true });
  }, []);

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    inputChRef.current = null;
    clipboardChRef.current = null;
    ftChRef.current = null;
    controlChRef.current = null;
    cursorChRef.current = null;
    terminalChRef.current = null;
    setStream(null);
    setCursor(null);
  }, []);

  const getFtChannel = useCallback(() => ftChRef.current, []);
  const getPc = useCallback(() => pcRef.current, []);

  return { startOffer, stream, cursor, handleAnswer, handleIceCandidate, sendInput, sendClipboard, setQuality, getPc, disconnect, getFtChannel, getTerminalChannel: () => terminalChRef.current };
}
