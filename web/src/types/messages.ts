// web/src/types/messages.ts
export type SignalingMessage =
  | { type: 'join'; peer_id: string; password: string }
  | { type: 'joined'; viewer_id: string }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice_candidate'; candidate: RTCIceCandidateInit }
  | { type: 'error'; code: string }
  | { type: 'registered'; peer_id: string }
  | { type: 'agent_disconnected' }
  | { type: 'session_taken_over' }
  | { type: 'viewer_pending'; viewer_id: string; remote_ip: string }
  | { type: 'approved' }
  | { type: 'denied'; reason: string }
  | { type: 'switch_display'; index: number }
  | { type: 'session_mode'; mode: 'gui' | 'terminal' }
  | { type: 'display_list'; displays: Array<{ index: number; width: number; height: number; is_primary: boolean }> };
