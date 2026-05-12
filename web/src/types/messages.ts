// web/src/types/messages.ts
export type SignalingMessage =
  | { type: 'join'; peer_id: string; password: string }
  | { type: 'joined'; viewer_id: string }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice_candidate'; candidate: RTCIceCandidateInit }
  | { type: 'error'; code: string }
  | { type: 'registered'; peer_id: string }
  | { type: 'agent_disconnected' };
