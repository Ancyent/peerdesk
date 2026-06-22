import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { normToPx } from '../lib/viewerGeom';

interface Props {
  stream: MediaStream | null;
  audioStream?: MediaStream | null;
  isViewOnly?: boolean;
  onMouseMove: (x: number, y: number) => void;
  onMouseDown: (button: number) => void;
  onMouseUp: (button: number) => void;
  onKeyDown: (key: string) => void;
  onKeyUp: (key: string) => void;
  onScroll: (dx: number, dy: number) => void;
  cursor?: { x: number; y: number } | null;
}

export interface ViewerHandle {
  videoElement: HTMLVideoElement | null;
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(
  { stream, audioStream, isViewOnly = false, onMouseMove, onMouseDown, onMouseUp, onKeyDown, onKeyUp, onScroll, cursor },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [audioMuted, setAudioMuted] = useState(true);

  useImperativeHandle(ref, () => ({ get videoElement() { return videoRef.current; } }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(console.error);
    const sync = setInterval(() => {
      if (video.buffered.length > 0) {
        const live = video.buffered.end(video.buffered.length - 1);
        if (live - video.currentTime > 0.5) video.currentTime = live - 0.1;
      }
    }, 1000);
    return () => clearInterval(sync);
  }, [stream]);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(() => {});
    }
  }, [audioStream]);

  const relPos = (e: React.MouseEvent) => {
    const video = videoRef.current;
    const vw = video?.videoWidth ?? 0, vh = video?.videoHeight ?? 0;
    if (!vw || !vh) return { x: 0, y: 0, inBounds: false };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ca = rect.width / rect.height, va = vw / vh;
    let rW: number, rH: number, oX: number, oY: number;
    if (ca > va) { rH = rect.height; rW = rH * va; oX = (rect.width - rW) / 2; oY = 0; }
    else          { rW = rect.width; rH = rW / va;  oX = 0; oY = (rect.height - rH) / 2; }
    const lX = e.clientX - rect.left - oX, lY = e.clientY - rect.top - oY;
    return { x: lX / rW, y: lY / rH, inBounds: lX >= 0 && lY >= 0 && lX <= rW && lY <= rH };
  };

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', background: '#000' }} />
        <div tabIndex={0} style={{ position: 'absolute', inset: 0, outline: 'none', cursor: isViewOnly ? 'default' : 'none' }}
          onMouseMove={e => { if (isViewOnly) return; const p = relPos(e); if (p.inBounds) onMouseMove(p.x, p.y); }}
          onMouseDown={e => { if (isViewOnly) return; e.preventDefault(); const p = relPos(e); if (p.inBounds) onMouseDown(e.button); }}
          onMouseUp={e => { if (isViewOnly) return; e.preventDefault(); const p = relPos(e); if (p.inBounds) onMouseUp(e.button); }}
          onKeyDown={e => { if (isViewOnly) return; e.preventDefault(); onKeyDown(e.key); }}
          onKeyUp={e => { if (isViewOnly) return; e.preventDefault(); onKeyUp(e.key); }}
          onWheel={e => { if (isViewOnly) return; e.preventDefault(); onScroll(Math.round(e.deltaX), Math.round(e.deltaY)); }}
          onMouseEnter={e => { if (!isViewOnly) (e.currentTarget as HTMLDivElement).focus(); }}
          onContextMenu={e => e.preventDefault()}
        />
        {(() => {
          if (!cursor || !wrapRef.current || !videoRef.current) return null;
          const r = wrapRef.current.getBoundingClientRect();
          const p = normToPx(cursor.x, cursor.y, { width: r.width, height: r.height },
            videoRef.current.videoWidth, videoRef.current.videoHeight);
          if (!p) return null;
          return (
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ position: 'absolute',
              left: p.left, top: p.top, pointerEvents: 'none', zIndex: 6,
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.7))' }}>
              <path d="M3 2 L3 20 L8 15 L11 21 L14 20 L11 14 L18 14 Z" fill="#fff" stroke="#000" strokeWidth="1.5" />
            </svg>
          );
        })()}
        {audioStream && (
          <>
            <audio ref={audioRef} autoPlay muted={audioMuted} style={{ display: 'none' }} />
            <button onClick={() => setAudioMuted(m => !m)} style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, padding: '4px 10px', borderRadius: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12 }}>
              {audioMuted ? '🔇 Unmute' : '🔊 Mute'}
            </button>
          </>
        )}
      </div>
    </div>
  );
});
