/**
 * The maths behind cropping a photo to the meeting slide's shape
 * (Graeme, 2026-08-28: a portrait photo should be croppable to the bit
 * that's actually wanted, rather than shown letterboxed or squashed).
 *
 * The picture is laid over a fixed landscape frame, scaled to cover it and
 * then moved around underneath. Two rules keep it honest:
 *
 *   - it can never be smaller than the frame, so no empty corners;
 *   - it can never be dragged past its own edge, so no empty strip.
 *
 * Kept separate from the dialog because off-by-one errors here are the sort
 * that only show up as a sliver of background in a photo on a wall-mounted
 * screen in a meeting, which is a bad moment to find them.
 */

export interface Size { width: number; height: number }

/** The smallest scale at which the image still covers the whole frame. */
export function coverScale(image: Size, frame: Size): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/**
 * Keep the image covering the frame however far it's dragged.
 *
 * Offsets are the image centre relative to the frame centre, in frame
 * pixels. The slack in each direction is however much the scaled image
 * overhangs the frame, halved — beyond that the frame would show through.
 */
export function clampOffset(
  offset: { x: number; y: number },
  image: Size,
  frame: Size,
  scale: number,
): { x: number; y: number } {
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const slackX = Math.max(0, (scaledWidth - frame.width) / 2);
  const slackY = Math.max(0, (scaledHeight - frame.height) / 2);
  return {
    x: Math.min(slackX, Math.max(-slackX, offset.x)),
    y: Math.min(slackY, Math.max(-slackY, offset.y)),
  };
}

export interface DrawRect { dx: number; dy: number; dw: number; dh: number }

/**
 * Where to paint the image on the output canvas so the result matches
 * exactly what was on screen.
 *
 * `outputWidth` is usually larger than the on-screen frame — the frame is
 * however big the dialog happens to be, while the output is a fixed size —
 * so everything scales by the ratio between them.
 */
export function computeDrawRect(
  image: Size,
  frame: Size,
  scale: number,
  offset: { x: number; y: number },
  outputWidth: number,
): DrawRect {
  const ratio = frame.width > 0 ? outputWidth / frame.width : 1;
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  return {
    dx: (frame.width / 2 + offset.x - scaledWidth / 2) * ratio,
    dy: (frame.height / 2 + offset.y - scaledHeight / 2) * ratio,
    dw: scaledWidth * ratio,
    dh: scaledHeight * ratio,
  };
}
