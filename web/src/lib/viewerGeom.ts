export interface Box { width: number; height: number; }

/** Pixel position (left/top within the element) of a normalized 0..1 point on a
 *  video shown with object-fit: contain (letterboxed). null if video size unknown. */
export function normToPx(
  x: number, y: number, rect: Box, vw: number, vh: number,
): { left: number; top: number } | null {
  if (!vw || !vh) return null;
  const ca = rect.width / rect.height, va = vw / vh;
  let rW: number, rH: number, oX: number, oY: number;
  if (ca > va) { rH = rect.height; rW = rH * va; oX = (rect.width - rW) / 2; oY = 0; }
  else { rW = rect.width; rH = rW / va; oX = 0; oY = (rect.height - rH) / 2; }
  return { left: oX + x * rW, top: oY + y * rH };
}
