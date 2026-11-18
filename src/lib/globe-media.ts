/** Pure decisions for the Mundo LUXE media (no DOM): which clip may play and which piece
 * owns the front after a drag. Depth is the z of a panel's normal after the globe turns:
 * 1 facing the visitor, 0 on the silhouette, −1 behind. */

export interface Depthed { readonly index: number; readonly depth: number }

/** A clip plays only when it is clearly turned towards the visitor (≈ within 50° of the front). */
export const PLAY_DEPTH = .64;
/** Hysteresis: a clip that already plays keeps playing until it turns a little further away,
 * so a small sway or a hesitant drag never toggles it on and off. */
export const KEEP_DEPTH = .5;
/** After a drag, the nearest piece within ≈ 26° of the front is gently settled there. */
export const SETTLE_DEPTH = .9;

export interface PlaybackConditions {
  /** Section on screen, page visible, viewer closed. */
  readonly visible: boolean;
  /** Reduced motion or data saver: posters only. */
  readonly stillOnly: boolean;
}

/** The single clip to play (or -1): the most frontal one beyond the threshold. Never two. */
export function pickPlaying(clips: readonly Depthed[], current: number, conditions: PlaybackConditions): number {
  if (!conditions.visible || conditions.stillOnly || !clips.length) return -1;
  let best = -1;
  let bestDepth = -Infinity;
  for (const clip of clips) {
    const threshold = clip.index === current ? KEEP_DEPTH : PLAY_DEPTH;
    if (clip.depth >= threshold && clip.depth > bestDepth) { best = clip.index; bestDepth = clip.depth; }
  }
  return best;
}

/** The piece to settle on after a drag, or -1 when nothing is close enough to the front. */
export function frontmost(pieces: readonly Depthed[], minimum = SETTLE_DEPTH): number {
  let best = -1;
  let bestDepth = minimum;
  for (const piece of pieces) if (piece.depth >= bestDepth) { best = piece.index; bestDepth = piece.depth; }
  return best;
}
