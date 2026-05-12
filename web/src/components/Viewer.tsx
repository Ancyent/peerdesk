// web/src/components/Viewer.tsx
import { useEffect, useRef, useState } from 'react';

interface Props {
  stream: MediaStream | null;
  audioStream?: MediaStream | null;
  onMouseMove: (x: number, y: number) => void;
  onMouseDown: (button: number) => void;
  onMouseUp: (button: number) => void;
  onKeyDown: (key: string) => void;
  onKeyUp: (key: string) => void;
  onScroll: (dx: number, dy: number) => void;
}

export function Viewer({ stream, audioStream, onMouseMove, onMouseDown, onMouseUp, onKeyDown, onKeyUp, onScroll }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioMuted, setAudioMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(console.error);

    // Periodically sync to live position to drain jitter buffer buildup
    const syncInterval = setInterval(() => {
      if (video.buffered.length > 0) {
        const liveEdge = video.buffered.end(video.buffered.length - 1);
        if (liveEdge - video.currentTime > 0.5) {
          video.currentTime = liveEdge - 0.1;
        }
      }
    }, 1000);

    return () => clearInterval(syncInterval);
  }, [stream]);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(() => { /* autoplay policy */ });
    }
  }, [audioStream]);

  // Calculate mouse position relative to the actual rendered video area,
  // accounting for letterbox bars added by object-fit: contain.
  const relPos = (e: React.MouseEvent): { x: number; y: number; inBounds: boolean } => {
    const video = videoRef.current;
    const vw = video?.videoWidth ?? 0;
    const vh = video?.videoHeight ?? 0;
    if (!vw || !vh) return { x: 0, y: 0, inBounds: false };

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const containerAspect = rect.width / rect.height;
    const videoAspect = vw / vh;

    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (containerAspect > videoAspect) {
      renderH = rect.height;
      renderW = rect.height * videoAspect;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    } else {
      renderW = rect.width;
      renderH = rect.width / videoAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    }

    const localX = e.clientX - rect.left - offsetX;
    const localY = e.clientY - rect.top - offsetY;
    const inBounds = localX >= 0 && localY >= 0 && localX <= renderW && localY <= renderH;
    return {
      x: Math.round((localX / renderW) * vw),
      y: Math.round((localY / renderH) * vh),
      inBounds,
    };
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', background: '#000' }}
        />
        <div
          tabIndex={0}
          style={{ position: 'absolute', inset: 0, outline: 'none', cursor: 'none' }}
          onMouseMove={(e) => { const p = relPos(e); if (p.inBounds) onMouseMove(p.x, p.y); }}
          onMouseDown={(e) => { e.preventDefault(); const p = relPos(e); if (p.inBounds) onMouseDown(e.button); }}
          onMouseUp={(e) => { e.preventDefault(); const p = relPos(e); if (p.inBounds) onMouseUp(e.button); }}
          onKeyDown={(e) => { e.preventDefault(); onKeyDown(e.key); }}
          onKeyUp={(e) => { e.preventDefault(); onKeyUp(e.key); }}
          onWheel={(e) => { e.preventDefault(); onScroll(Math.round(e.deltaX), Math.round(e.deltaY)); }}
          onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).focus()}
          onContextMenu={(e) => e.preventDefault()}
        />
        {audioStream && (
          <>
            <audio ref={audioRef} autoPlay muted={audioMuted} style={{ display: 'none' }} />
            <button
              onClick={() => setAudioMuted(m => !m)}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 5,
                padding: '4px 10px', borderRadius: 4,
                background: 'rgba(0,0,0,0.6)', color: '#fff',
                border: 'none', cursor: 'pointer', fontSize: 12,
              }}
            >
              {audioMuted ? '🔇 Unmute' : '🔊 Mute'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
