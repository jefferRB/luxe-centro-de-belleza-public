/** Playback for the clips on the Mundo LUXE globe. At most one clip plays: the one turned
 * towards the visitor (lib/globe-media.ts), while the section is on screen, the page is
 * visible and the viewer is closed. A clip gets its source only the first time it is due to
 * play (no preloading); the others keep their real poster. Reduced motion and data saver:
 * posters only. Always muted, no native controls on the sphere. */
import { pickPlaying, type Depthed } from '../lib/globe-media';

export interface GlobeVideoOptions {
  /** Video panels, in the rotor's panel order (their index in `panels`). */
  readonly clips: readonly { readonly index: number; readonly panel: HTMLElement }[];
  readonly depth: (index: number) => number;
  readonly onScreen: () => boolean;
  readonly stillOnly: () => boolean;
}

export class GlobeVideos {
  private readonly options: GlobeVideoOptions;
  private readonly controller = new AbortController();
  private playing = -1;
  private suspended = false;
  /** Clips whose playback the browser refused: not retried on every frame. */
  private readonly refused = new Set<number>();

  constructor(options: GlobeVideoOptions) {
    this.options = options;
    document.addEventListener('visibilitychange', () => this.update(), { signal: this.controller.signal });
  }

  /** E.g. while the shared viewer is open. */
  suspend(value: boolean) {
    this.suspended = value;
    this.update();
  }

  /** Cheap: called after every paint of the globe; only acts when the choice changes. */
  update() {
    const { clips, depth, onScreen, stillOnly } = this.options;
    const visible = onScreen() && !this.suspended && document.visibilityState === 'visible';
    const candidates: Depthed[] = clips.filter((clip) => !this.refused.has(clip.index)).map((clip) => ({ index: clip.index, depth: depth(clip.index) }));
    const next = pickPlaying(candidates, this.playing, { visible, stillOnly: stillOnly() });
    if (next === this.playing) return;
    this.pause(this.playing);
    this.playing = next;
    this.play(next);
  }

  dispose() {
    this.controller.abort();
    for (const clip of this.options.clips) {
      const video = this.video(clip.panel);
      clip.panel.removeAttribute('data-playing');
      if (!video) continue;
      video.pause();
      video.removeAttribute('data-live');
      if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
    }
    this.playing = -1;
  }

  private video(panel: HTMLElement) {
    return panel.querySelector<HTMLVideoElement>('[data-globe-video]');
  }

  private play(index: number) {
    const clip = this.options.clips.find((candidate) => candidate.index === index);
    const video = clip && this.video(clip.panel);
    // Not mounted yet (photos load as the globe approaches): try again on a later paint.
    if (!clip || !video) { this.playing = -1; return; }
    if (!video.getAttribute('src') && video.dataset.src) {
      video.src = video.dataset.src;
      // Frames are shown only once they really move: the poster stays until then.
      video.addEventListener('playing', () => video.setAttribute('data-live', ''), { signal: this.controller.signal });
    }
    video.muted = true;
    clip.panel.setAttribute('data-playing', '');
    video.play().catch((error: unknown) => {
      // Interrupted by our own pause: nothing to do. Refused (e.g. power saving): the poster stays.
      if ((error as { name?: string } | null)?.name !== 'NotAllowedError') return;
      clip.panel.removeAttribute('data-playing');
      this.refused.add(index);
      if (this.playing === index) this.playing = -1;
    });
  }

  private pause(index: number) {
    const clip = this.options.clips.find((candidate) => candidate.index === index);
    const video = clip && this.video(clip.panel);
    clip?.panel.removeAttribute('data-playing');
    video?.pause();
  }
}
