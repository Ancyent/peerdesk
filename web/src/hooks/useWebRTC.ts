// web/src/hooks/useWebRTC.ts
import { useCallback, useRef, useState } from 'react';
import type { SignalingMessage } from '../types/messages';

export function useWebRTC(sendSignaling: (msg: SignalingMessage) => void) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const inputChRef = useRef<RTCDataChannel | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sendSignalingRef = useRef(sendSignaling);
  sendSignalingRef.current = sendSignaling;

  const startOffer = useCallback(() => {
    // Close any existing connection before creating a new one
    pcRef.current?.close();
    inputChRef.current = null;
    setStream(null);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    inputChRef.current = pc.createDataChannel('input', { ordered: true });

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

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    inputChRef.current = null;
    setStream(null);
  }, []);

  return { startOffer, stream, handleAnswer, handleIceCandidate, sendInput, disconnect };
}
