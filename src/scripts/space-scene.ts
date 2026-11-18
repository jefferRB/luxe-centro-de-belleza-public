/** Renderer of «El espacio» in 3D: draws the crown's cards, the portal and the rings of
 * Saturn through one camera (geometry in lib/space-camera.ts).
 *
 * Each element keeps its place in the page's layout; one matrix3d per element projects it
 * through the camera, so the cards, the portal (with its photo, arrows and controls) and the
 * rings share one perspective. The rings are projected point by point into two screen-space
 * SVG layers: the far half behind the portal, the near half in front of it, so the orbit
 * really passes in front of and behind the portal. Cards are ordered by their distance to
 * the lens, on the correct side of the portal plane.
 *
 * Layout is read only in measure() (on resize or when a dive starts), never per frame. */
import { wrapOffset } from '../lib/orbit-layout';
import {
  cameraFor, cardPlacement, crownOptics, crownRadius, cssMatrix, diveDistance, elementMatrix, HOME_POSE, multiply, NEAR, project, ringPaths, ringPoint, rotateY, scale3, smoothstep, transformPoint, translate,
  type Camera, type CameraPose, type CrownOptics, type Point, type Ring, type SceneFrame,
} from '../lib/space-camera';
import type { CrownProfile } from '../lib/space-orbit';

export interface SpaceSceneOptions {
  /** The orbit container: world origin and stacking context of the scene. */
  readonly root: HTMLElement;
  readonly portal: HTMLElement;
  /** The static ring of the composition at rest: its box gives the ring's centre and radii. */
  readonly ring: HTMLElement;
  readonly cards: readonly HTMLElement[];
  readonly views: readonly HTMLElement[];
  readonly layers: { readonly back: SVGSVGElement; readonly front: SVGSVGElement };
  readonly profile: () => CrownProfile;
  readonly displayed: () => number;
  /** Fewer ring samples on constrained devices. */
  readonly lite: boolean;
}

interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface RingLayer { readonly ring: (main: Ring) => Ring; readonly paths: readonly SVGPathElement[] }

/** Layout position of an element inside `root` (transforms ignored). */
function offsetWithin(element: HTMLElement, root: HTMLElement): Point {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

/** The photo itself inside its box: always whole (object-fit: contain), centred. */
function containedPhoto(box: Box, view: HTMLElement | undefined): Box {
  const width = Number(view?.dataset.fullWidth) || box.width;
  const height = Number(view?.dataset.fullHeight) || box.height;
  const fit = Math.min(box.width / width, box.height / height);
  const w = width * fit;
  const h = height * fit;
  return { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };
}

export class SpaceScene {
  private readonly options: SpaceSceneOptions;
  private pose: CameraPose = HOME_POSE;
  private crown = 0;
  private optics: CrownOptics = { focal: 1000, tilt: .2, cardScale: .78 };
  private main: Ring = { center: { x: 0, y: 0 }, radius: 100, tilt: .2 };
  private frame: SceneFrame = { ringCenter: { x: 0, y: 0 }, photoCenter: { x: 0, y: 0 }, screenCenter: { x: 0, y: 0 }, focal: 1000 };
  private portalLayout: Point = { x: 0, y: 0 };
  private cardLayout: Point = { x: 0, y: 0 };
  private cardSize = { width: 0, height: 0 };
  private photoBox: Box = { x: 0, y: 0, width: 0, height: 0 };
  private ringKey = '';
  private disposed = false;
  private readonly rings: RingLayer[] = [];
  private readonly gradients: { front?: SVGLinearGradientElement; back?: SVGLinearGradientElement };
  private readonly glint?: SVGPathElement;

  constructor(options: SpaceSceneOptions) {
    this.options = options;
    const { back, front } = options.layers;
    const pick = (layer: SVGSVGElement, name: string) => layer.querySelector<SVGPathElement>(`[data-ring="${name}"]`);
    const both = (name: string) => [pick(back, name), pick(front, name)].filter((path): path is SVGPathElement => Boolean(path));
    const tilted = (radius: number, sine: number) => (main: Ring): Ring => ({ center: main.center, radius: main.radius * radius, tilt: Math.asin(Math.min(.9, Math.sin(main.tilt) * sine)) });
    // Coplanar halo and main ring; the outer and inner rings lean a little more and a little
    // less, so they separate and slide over each other as the camera moves (depth between layers).
    this.rings.push(
      { ring: tilted(1.14, 1.105), paths: both('outer') },
      { ring: (main) => main, paths: both('halo') },
      { ring: (main) => main, paths: both('main') },
      { ring: tilted(.86, .907), paths: both('inner') },
    );
    this.gradients = {
      front: front.querySelector<SVGLinearGradientElement>('linearGradient') ?? undefined,
      back: back.querySelector<SVGLinearGradientElement>('linearGradient') ?? undefined,
    };
    this.glint = pick(front, 'glint') ?? undefined;
    for (const card of options.cards) {
      card.style.transformOrigin = '0 0';
      // The camera never shows a card from behind; let the browser not guess.
      card.style.backfaceVisibility = 'visible';
    }
    options.portal.style.transformOrigin = '0 0';
    options.layers.back.removeAttribute('data-off');
    options.layers.front.removeAttribute('data-off');
    this.measure();
  }

  get camera(): Camera { return cameraFor(this.pose, this.frame); }
  get currentPose(): CameraPose { return this.pose; }
  get orbitWidth(): number { return this.options.root.clientWidth; }

  /** Re-reads the layout (resize, breakpoint, the photo shown). */
  measure() {
    const { root, ring, cards, portal } = this.options;
    const center = offsetWithin(ring, root);
    const rx = ring.offsetWidth / 2;
    const ry = ring.offsetHeight / 2;
    const card = cards[0];
    const profile = this.options.profile();
    const radius = crownRadius(rx, ry, profile, cards.length, card?.offsetWidth ?? 0);
    this.optics = crownOptics(radius, ry, profile.backScale);
    this.main = { center, radius, tilt: this.optics.tilt };
    this.portalLayout = offsetWithin(portal, root);
    this.cardLayout = card ? offsetWithin(card, root) : center;
    this.cardSize = { width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 };
    const view = this.options.views[this.options.displayed()] ?? this.options.views[0];
    const picture = view?.querySelector('picture');
    if (picture instanceof HTMLElement && picture.offsetWidth > 0) {
      this.photoBox = { ...offsetWithin(picture, root), width: picture.offsetWidth, height: picture.offsetHeight };
    }
    const photoCenter = { x: this.photoBox.x + this.photoBox.width / 2, y: this.photoBox.y + this.photoBox.height / 2 };
    this.frame = { ringCenter: center, photoCenter, screenCenter: this.frame.screenCenter.x ? this.frame.screenCenter : photoCenter, focal: this.optics.focal };
    this.ringKey = '';
    this.render();
  }

  /** Where a dived photo lands (viewport px): where the interior view will show it, or the
   * centre of the screen. Returns the camera distance that lands it at that size. */
  aimAt(landing: DOMRect | undefined, index = this.options.displayed()): number {
    const box = this.options.root.getBoundingClientRect();
    const target = landing ?? new DOMRect(innerWidth * .04, innerHeight * .07, innerWidth * .92, innerHeight * .86);
    this.frame = { ...this.frame, screenCenter: { x: target.left + target.width / 2 - box.left, y: target.top + target.height / 2 - box.top } };
    this.ringKey = '';
    const photo = containedPhoto(this.photoBox, this.options.views[index]);
    return diveDistance(photo, target, this.minimumDistance);
  }

  /** The closest the camera may come (focal lengths): never through the cards in front. */
  get minimumDistance(): number {
    return (this.main.radius * Math.cos(this.main.tilt) + this.main.radius * .3) / this.optics.focal;
  }

  /** The selected photo as the visitor sees it now (viewport px), for the hand-off to 2D. */
  photoRect(index = this.options.displayed()): DOMRect | undefined {
    const camera = this.camera;
    const photo = containedPhoto(this.photoBox, this.options.views[index]);
    const corners = [[photo.x, photo.y], [photo.x + photo.width, photo.y], [photo.x, photo.y + photo.height], [photo.x + photo.width, photo.y + photo.height]] as const;
    const points = corners.map(([x, y]) => project(camera, [x, y, 0]));
    if (points.some((point) => !point)) return undefined;
    const xs = points.map((point) => point!.x);
    const ys = points.map((point) => point!.y);
    const box = this.options.root.getBoundingClientRect();
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return new DOMRect(box.left + left, box.top + top, Math.max(...xs) - left, Math.max(...ys) - top);
  }

  setPose(pose: CameraPose) {
    this.pose = pose;
    this.render();
  }

  setCrown(position: number) {
    this.crown = position;
    this.render();
  }

  render() {
    if (this.disposed) return;
    const camera = this.camera;
    const { portal } = this.options;
    portal.style.transform = cssMatrix(elementMatrix(camera, this.portalLayout, translate(this.portalLayout.x, this.portalLayout.y)));
    this.renderCards(camera);
    this.renderRings(camera);
  }

  private renderCards(camera: Camera) {
    const { cards } = this.options;
    const profile = this.options.profile();
    const count = cards.length;
    const { width, height } = this.cardSize;
    const ringCentre: [number, number, number] = [this.main.center.x, this.main.center.y, 0];
    const distance = Math.hypot(camera.position[0] - ringCentre[0], camera.position[1] - ringCentre[1], camera.position[2] - ringCentre[2]);
    const near = distance - this.main.radius;
    const far = distance + this.main.radius;
    const fadeDive = 1 - smoothstep(.5, .9, this.pose.dive);
    const placed = cards.map((card, index) => {
      const theta = count > 0 ? (wrapOffset(index - this.crown, count) / count) * Math.PI * 2 : 0;
      const { position, yaw } = cardPlacement(theta, this.main, profile.facing, this.pose.yaw);
      const model = multiply(multiply(multiply(translate(position[0], position[1], position[2]), rotateY(yaw)), scale3(this.optics.cardScale)), translate(-width / 2, -height / 2));
      const centre = project(camera, position);
      // A card whose corners come near the lens is not drawn (never "through" a card).
      const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => transformPoint(model, [x!, y!, 0]));
      const safe = corners.every((corner) => project(camera, corner) !== undefined);
      return { card, position, model, centre, safe };
    });
    const order = placed.filter((entry) => entry.centre).sort((a, b) => b.centre!.depth - a.centre!.depth);
    placed.forEach((entry) => {
      const { card, centre } = entry;
      if (!centre || !entry.safe) { card.style.visibility = 'hidden'; return; }
      const depth = Math.min(1, Math.max(0, (far - centre.depth) / Math.max(1, far - near)));
      const nearFade = smoothstep(NEAR * 6, camera.focal * .5, centre.depth);
      const opacity = (profile.backOpacity + (1 - profile.backOpacity) * depth) * nearFade * fadeDive;
      // The camera is always on the visitor's side of the portal: a card with z > 0 is in front of it.
      const rank = order.indexOf(entry);
      card.style.transform = cssMatrix(elementMatrix(camera, this.cardLayout, entry.model));
      card.style.opacity = opacity.toFixed(3);
      card.style.zIndex = String((entry.position[2] > 0 ? 31 : 11) + rank);
      card.style.setProperty('--depth', depth.toFixed(3));
      card.style.visibility = opacity < .01 ? 'hidden' : '';
    });
  }

  private renderRings(camera: Camera) {
    const key = `${this.pose.yaw.toFixed(3)}|${this.pose.pitch.toFixed(3)}|${this.pose.distance.toFixed(4)}|${this.pose.dive.toFixed(4)}`;
    if (key === this.ringKey) return;
    this.ringKey = key;
    const samples = this.options.lite ? 32 : 64;
    for (const layer of this.rings) {
      const paths = ringPaths(camera, layer.ring(this.main), samples);
      const [back, front] = layer.paths;
      back?.setAttribute('d', paths.back);
      front?.setAttribute('d', paths.front);
      if (layer.paths === this.rings[2]?.paths && this.glint) this.glint.setAttribute('d', paths.full);
    }
    // Depth shading: brightest where the ring is nearest, faint at the far side.
    const at = (theta: number) => project(camera, ringPoint(this.main, theta));
    const left = at(-Math.PI / 2);
    const right = at(Math.PI / 2);
    const nearest = at(0);
    const farthest = at(Math.PI);
    const sides = left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : undefined;
    const aim = (gradient: SVGLinearGradientElement | undefined, to: { x: number; y: number } | undefined) => {
      if (!gradient || !sides || !to) return;
      gradient.setAttribute('x1', sides.x.toFixed(1));
      gradient.setAttribute('y1', sides.y.toFixed(1));
      gradient.setAttribute('x2', to.x.toFixed(1));
      gradient.setAttribute('y2', (Math.abs(to.y - sides.y) < 1 ? sides.y + 1 : to.y).toFixed(1));
    };
    aim(this.gradients.front, nearest);
    aim(this.gradients.back, farthest);
    // Crossing the portal: the rings slide away to the sides and fade.
    const fade = (1 - smoothstep(.3, .8, this.pose.dive)).toFixed(3);
    this.options.layers.back.style.opacity = fade;
    this.options.layers.front.style.opacity = fade;
  }

  dispose() {
    this.disposed = true;
    const { portal, cards, layers } = this.options;
    for (const element of [portal, ...cards]) {
      for (const name of ['transform', 'transform-origin', 'backface-visibility', 'visibility']) element.style.removeProperty(name);
    }
    for (const layer of [layers.back, layers.front]) {
      layer.setAttribute('data-off', '');
      layer.style.removeProperty('opacity');
      layer.querySelectorAll('path').forEach((path) => path.removeAttribute('d'));
    }
  }
}
