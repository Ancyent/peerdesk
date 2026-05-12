// web/src/components/Viewer.tsx
import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  onMouseMove: (x: number, y: number) => void;
  onMouseDown: (button: number) => void;
  onMouseUp: (button: number) => void;
  onKeyDown: (key: string) => void;
  onKeyUp: (key: string) => void;
  onScroll: (dx: number, dy: number) => void;
}

export function Viewer({ stream, onMouseMove, onMouseDown, onMouseUp, onKeyDown, onKeyUp, onScroll }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

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

  const relPos = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const v = videoRef.current;
    const sx = v && v.videoWidth > 0 ? v.videoWidth / rect.width : 1;
    const sy = v && v.videoHeight > 0 ? v.videoHeight / rect.height : 1;
    return {
      x: Math.round((e.clientX - rect.left) * sx),
      y: Math.round((e.clientY - rect.top) * sy)
    };
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        style={{ width: '100%', height: '100%', display: 'block', background: '#000' }}
      />
      <div
        tabIndex={0}
        style={{ position: 'absolute', inset: 0, outline: 'none', cursor: 'none' }}
        onMouseMove={(e) => { const p = relPos(e); onMouseMove(p.x, p.y); }}
        onMouseDown={(e) => { e.preventDefault(); onMouseDown(e.button); }}
        onMouseUp={(e) => { e.preventDefault(); onMouseUp(e.button); }}
        onKeyDown={(e) => { e.preventDefault(); onKeyDown(e.key); }}
        onKeyUp={(e) => { e.preventDefault(); onKeyUp(e.key); }}
        onWheel={(e) => { e.preventDefault(); onScroll(Math.round(e.deltaX), Math.round(e.deltaY)); }}
        onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).focus()}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
