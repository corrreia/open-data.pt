import * as THREE from "three";

/**
 * Moving about the map the way people already know from Google Maps.
 *
 * Mouse: drag moves the map, held by the spot that was grabbed; the wheel zooms about the pointer;
 * the right button, or Ctrl or Shift with the left, turns and tilts; a double click zooms in.
 * Touch: one finger moves; two fingers pinch to zoom and twist to turn, and drawn up or down
 * together they tilt; a double tap zooms in.
 * Keys: the arrows move, + and − zoom.
 */

/** Where the camera stands, said the way a map says it. */
export interface View {
  /** The point of the ground at the middle of the screen: kilometres east, and kilometres south, of the origin. */
  x: number;
  z: number;
  /** Kilometres from that point to the camera. */
  distance: number;
  /** Radians the camera has turned clockwise from looking north. */
  bearing: number;
  /** Radians the camera leans from straight down. */
  tilt: number;
}

const NEAREST = 6;
const FARTHEST = 2600;
const STEEPEST = (80 * Math.PI) / 180;
/** How far the middle of the screen may wander from the middle of the map, in kilometres. */
const REACH = 700;
/** The share of the way to its goal the view covers in a millisecond, near enough. */
const EASE = 0.012;
const TURN_PER_PIXEL = 0.005;
const TILT_PER_PIXEL = 0.004;

export class MapControls {
  /** Where the view is heading; the camera eases towards it. */
  readonly goal: View;
  readonly #now: View;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #element: HTMLElement;
  readonly #pointers = new Map<number, [x: number, y: number]>();
  readonly #ray = new THREE.Raycaster();
  readonly #ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  #turning = false;
  /** Kilometres a millisecond the map was moving when it was let go, to glide on. */
  #glide: [x: number, z: number] = [0, 0];
  #moved = 0;
  #ease = EASE;
  /** Called whenever a person takes hold of the map. */
  onTouch: () => void = () => {};

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement, start: View) {
    this.#camera = camera;
    this.#element = element;
    this.goal = { ...start };
    this.#now = { ...start };
    this.#place();
    element.addEventListener("pointerdown", (event) => this.#down(event));
    element.addEventListener("pointermove", (event) => this.#move(event));
    for (const end of ["pointerup", "pointercancel", "pointerleave"] as const) element.addEventListener(end, (event) => this.#up(event));
    element.addEventListener("wheel", (event) => this.#wheel(event), { passive: false });
    element.addEventListener("dblclick", (event) => this.#zoomAbout(event.clientX, event.clientY, 0.5));
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", (event) => this.#key(event));
  }

  /** Sends the view somewhere at an unhurried pace, for an opening move; any touch takes over. */
  flyTo(view: View, ease: number): void {
    Object.assign(this.goal, view);
    this.#ease = ease;
  }

  /** Moves the camera a frame's worth towards its goal. */
  update(elapsedMs: number): void {
    if (this.#pointers.size === 0 && (this.#glide[0] !== 0 || this.#glide[1] !== 0)) {
      this.goal.x += this.#glide[0] * elapsedMs;
      this.goal.z += this.#glide[1] * elapsedMs;
      const fade = Math.exp(-elapsedMs / 280);
      this.#glide = Math.hypot(...this.#glide) < 0.0005 ? [0, 0] : [this.#glide[0] * fade, this.#glide[1] * fade];
    }
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -REACH, REACH);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -REACH, REACH);
    const share = 1 - Math.exp(-elapsedMs * this.#ease);
    this.#now.x += (this.goal.x - this.#now.x) * share;
    this.#now.z += (this.goal.z - this.#now.z) * share;
    this.#now.distance *= (this.goal.distance / this.#now.distance) ** share;
    this.#now.bearing += (this.goal.bearing - this.#now.bearing) * share;
    this.#now.tilt += (this.goal.tilt - this.#now.tilt) * share;
    this.#place();
  }

  #place(): void {
    const { x, z, distance, bearing, tilt } = this.#now;
    this.#camera.position.set(x - Math.sin(bearing) * Math.sin(tilt) * distance, Math.cos(tilt) * distance, z + Math.cos(bearing) * Math.sin(tilt) * distance);
    // Straight down has no up of its own: the bearing says which way the top of the screen faces.
    this.#camera.up.set(Math.sin(bearing), tilt < 0.01 ? 0 : 1, -Math.cos(bearing)).normalize();
    this.#camera.lookAt(x, 0, z);
    this.#camera.updateMatrixWorld();
  }

  /** The point of the ground under a place on the screen, as the camera stands now. */
  #under(clientX: number, clientY: number): THREE.Vector3 | undefined {
    const box = this.#element.getBoundingClientRect();
    this.#ray.setFromCamera(new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1), this.#camera);
    const hit = this.#ray.ray.intersectPlane(this.#ground, new THREE.Vector3());
    // Near the horizon the ground under the pointer is leagues away, and a nudge would fling the map.
    return hit === null || hit.distanceTo(this.#camera.position) > this.#now.distance * 6 ? undefined : hit;
  }

  /** Takes the view straight to its goal, for moves that must stay under the finger. */
  #snap(): void {
    Object.assign(this.#now, this.goal);
    this.#place();
  }

  #held(): void {
    this.#ease = EASE;
    this.#glide = [0, 0];
    this.onTouch();
  }

  #down(event: PointerEvent): void {
    this.#element.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, [event.clientX, event.clientY]);
    this.#turning = event.pointerType === "mouse" && (event.button === 2 || event.ctrlKey || event.shiftKey);
    this.#moved = performance.now();
    this.#held();
  }

  #up(event: PointerEvent): void {
    if (!this.#pointers.delete(event.pointerId)) return;
    // A finger lifted long after it last moved was resting, not throwing.
    if (performance.now() - this.#moved > 80) this.#glide = [0, 0];
  }

  /** Slides the map so that the ground that was under one place on the screen is under another. */
  #drag(fromX: number, fromY: number, toX: number, toY: number, elapsedMs: number): void {
    const from = this.#under(fromX, fromY);
    const to = this.#under(toX, toY);
    if (from === undefined || to === undefined) return;
    this.goal.x += from.x - to.x;
    this.goal.z += from.z - to.z;
    if (elapsedMs > 0) this.#glide = [(from.x - to.x) / elapsedMs, (from.z - to.z) / elapsedMs];
    this.#snap();
  }

  #turn(byX: number, byY: number): void {
    this.goal.bearing += byX * TURN_PER_PIXEL;
    this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt - byY * TILT_PER_PIXEL, 0, STEEPEST);
    this.#snap();
  }

  #move(event: PointerEvent): void {
    const last = this.#pointers.get(event.pointerId);
    if (last === undefined) return;
    const now = performance.now();
    const elapsed = now - this.#moved;
    this.#moved = now;
    const other = [...this.#pointers].find(([id]) => id !== event.pointerId)?.[1];
    this.#pointers.set(event.pointerId, [event.clientX, event.clientY]);

    if (other === undefined) {
      if (this.#turning) this.#turn(event.clientX - last[0], event.clientY - last[1]);
      else this.#drag(last[0], last[1], event.clientX, event.clientY, elapsed);
      return;
    }

    // Two fingers. Where their middle, their spread and their slant were, and are.
    const before = {
      x: (last[0] + other[0]) / 2,
      y: (last[1] + other[1]) / 2,
      spread: Math.hypot(last[0] - other[0], last[1] - other[1]),
      slant: Math.atan2(last[1] - other[1], last[0] - other[0]),
    };
    const after = {
      x: (event.clientX + other[0]) / 2,
      y: (event.clientY + other[1]) / 2,
      spread: Math.hypot(event.clientX - other[0], event.clientY - other[1]),
      slant: Math.atan2(event.clientY - other[1], event.clientX - other[0]),
    };
    const level = Math.abs(Math.sin(after.slant)) < 0.5;
    const steady = Math.abs(after.spread - before.spread) < 1.5 && Math.abs(Math.sin(after.slant - before.slant)) < 0.012;
    // Side by side and moving up or down without spreading or twisting: that is the tilt.
    if (level && steady && Math.abs(event.clientY - last[1]) > Math.abs(event.clientX - last[0])) {
      this.#turn(0, (event.clientY - last[1]) * 0.6);
      return;
    }
    this.#drag(before.x, before.y, after.x, after.y, 0);
    this.#glide = [0, 0];
    const held = this.#under(after.x, after.y);
    const zoom = before.spread / Math.max(1, after.spread);
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * zoom, NEAREST, FARTHEST);
    const twist = Math.atan2(Math.sin(after.slant - before.slant), Math.cos(after.slant - before.slant));
    this.goal.bearing -= twist;
    this.#snap();
    // Keep the ground that was between the fingers between them.
    const drifted = this.#under(after.x, after.y);
    if (held !== undefined && drifted !== undefined) {
      this.goal.x += held.x - drifted.x;
      this.goal.z += held.z - drifted.z;
      this.#snap();
    }
  }

  /** Zooms by a factor, keeping the ground under a place on the screen where it is. */
  #zoomAbout(clientX: number, clientY: number, factor: number): void {
    this.#held();
    const distance = THREE.MathUtils.clamp(this.goal.distance * factor, NEAREST, FARTHEST);
    const applied = distance / this.goal.distance;
    const held = this.#under(clientX, clientY);
    if (held !== undefined) {
      this.goal.x = held.x + (this.goal.x - held.x) * applied;
      this.goal.z = held.z + (this.goal.z - held.z) * applied;
    }
    this.goal.distance = distance;
  }

  #wheel(event: WheelEvent): void {
    event.preventDefault();
    // A mouse wheel counts lines, a trackpad pixels, and a trackpad pinch arrives as a wheel with Ctrl held.
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 32 : event.deltaY;
    this.#zoomAbout(event.clientX, event.clientY, Math.exp(THREE.MathUtils.clamp(pixels, -240, 240) * (event.ctrlKey ? 0.01 : 0.0022)));
  }

  #key(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
    const step = this.goal.distance * 0.12;
    const ahead: [number, number] = [Math.sin(this.goal.bearing), -Math.cos(this.goal.bearing)];
    const nearer = (): void => void (this.goal.distance = Math.max(NEAREST, this.goal.distance * 0.7));
    const moves = new Map<string, () => void>([
      ["ArrowUp", () => void ((this.goal.x += ahead[0] * step), (this.goal.z += ahead[1] * step))],
      ["ArrowDown", () => void ((this.goal.x -= ahead[0] * step), (this.goal.z -= ahead[1] * step))],
      ["ArrowLeft", () => void ((this.goal.x += ahead[1] * step), (this.goal.z -= ahead[0] * step))],
      ["ArrowRight", () => void ((this.goal.x -= ahead[1] * step), (this.goal.z += ahead[0] * step))],
      ["+", nearer],
      ["=", nearer],
      ["-", () => void (this.goal.distance = Math.min(FARTHEST, this.goal.distance / 0.7))],
    ]);
    const move = moves.get(event.key);
    if (move === undefined) return;
    event.preventDefault();
    this.#held();
    move();
  }
}
