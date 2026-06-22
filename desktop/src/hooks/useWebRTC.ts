// web/src/hooks/useWebRTC.ts
import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SignalingMessage } from '../types/messages';

export function useWebRTC(
  sendSignaling: (msg: SignalingMessage) => void,
  onClipboardFromAgent?: (text: string) => void
) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const inputChRef = useRef<RTCDataChannel | null>(null);
  const clipboardChRef = useRef<RTCDataChannel | null>(null);
  const ftChRef = useRef<RTCDataChannel | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
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
    setStream(null);

    // Fetch TURN/STUN config from the server (via the Tauri backend, which holds
    // the API key) so media can traverse NAT and different subnets. Without a
    // relay, a cross-network viewer connects but sees a black screen. Fall back
    // to public STUN if unavailable.
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      const servers = await invoke<RTCIceServer[]>('get_turn_credentials');
      if (servers && servers.length) iceServers = servers;
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

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    inputChRef.current = null;
    clipboardChRef.current = null;
    ftChRef.current = null;
    setStream(null);
  }, []);

  const getFtChannel = useCallback(() => ftChRef.current, []);

  const setMaxBitrate = useCallback(async (kbps: number | null) => {
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = kbps !== null ? kbps * 1000 : undefined;
    await sender.setParameters(params);
  }, []);

  return { startOffer, stream, handleAnswer, handleIceCandidate, sendInput, sendClipboard, disconnect, getFtChannel, setMaxBitrate };
}
