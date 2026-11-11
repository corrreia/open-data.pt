import * as THREE from "three";

/**
 * Moving about the map the way Google Earth is moved.
 *
 * Mouse: the left button drags the map, held by the spot that was grabbed, and lets it glide when
 * thrown. The wheel zooms on the spot under the pointer; a double click zooms in there and a double
 * right click zooms out. The right button zooms as it is drawn down or up and turns the map as it
 * is drawn sideways. The middle button, or Shift or Ctrl with the left, tilts and turns the view
 * about the spot under the pointer. Shift with the wheel tilts.
 * Touch: one finger drags; two fingers pinch to zoom and twist to turn, and drawn up or down
 * together they tilt; a double tap zooms in.
 * Keys: the arrows move, + and − zoom, Shift with the arrows turns and tilts.
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

type Hold = "drag" | "orbit" | "zoom";

/** Where on the screen a hold began, and the ground that was there. */
interface Pivot {
  x: number;
  y: number;
  ground: THREE.Vector3 | undefined;
}

const NEAREST = 5;
const FARTHEST = 2600;
const STEEPEST = (82 * Math.PI) / 180;
/** How far the middle of the screen may wander from the middle of the map, in kilometres. */
const REACH = 700;
/** The share of the way to its goal the view covers in a millisecond, near enough, when it is sent somewhere. */
const EASE = 0.012;
const TURN_PER_PIXEL = 0.006;
const TILT_PER_PIXEL = 0.005;
const DOUBLE_MS = 350;

export class MapControls {
  /** Where the view is, or is being sent. */
  readonly goal: View;
  readonly #now: View;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #element: HTMLElement;
  readonly #pointers = new Map<number, [x: number, y: number]>();
  readonly #ray = new THREE.Raycaster();
  readonly #ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  #hold: Hold = "drag";
  /** Where on the screen a hold began, and the ground that was there: what an orbit or a zoom turns about. */
  #pivot: Pivot = { x: 0, y: 0, ground: undefined };
  /** Kilometres a millisecond the map was moving when it was let go, to glide on. */
  #glide: [x: number, z: number] = [0, 0];
  /** Zoom still to be done, as the logarithm of its factor, and where on the screen it is about. */
  #zoom = { left: 0, x: 0, y: 0 };
  #moved = 0;
  #lastRight = 0;
  #ease = EASE;

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement, start: View) {
    this.#camera = camera;
    this.#element = element;
    this.goal = { ...start };
    this.#now = { ...start };
    this.#place();
    element.addEventListener("pointerdown", (event) => this.#down(event));
    element.addEventListener("pointermove", (event) => this.#move(event));
    for (const end of ["pointerup", "pointercancel"] as const) element.addEventListener(end, (event) => this.#up(event));
    element.addEventListener("wheel", (event) => this.#wheel(event), { passive: false });
    element.addEventListener("dblclick", (event) => this.#zoomSoon(event.clientX, event.clientY, Math.log(0.4)));
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    // The middle button would otherwise start the browser's own scrolling.
    element.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    window.addEventListener("keydown", (event) => this.#key(event));
  }

  /** Sends the view somewhere at a chosen pace; any touch takes over. */
  flyTo(view: View, ease: number): void {
    Object.assign(this.goal, view);
    this.#ease = ease;
  }

  /** Moves the camera on by a frame. */
  update(elapsedMs: number): void {
    if (Math.abs(this.#zoom.left) > 0.0005) {
      // A wheel's zoom is spread over a few frames, each one exactly about the spot it was asked on.
      const now = this.#zoom.left * (1 - Math.exp(-elapsedMs / 70));
      this.#zoom.left -= now;
      this.#zoomAbout(this.#zoom.x, this.#zoom.y, Math.exp(now));
    }
    if (this.#pointers.size === 0 && (this.#glide[0] !== 0 || this.#glide[1] !== 0)) {
      this.goal.x += this.#glide[0] * elapsedMs;
      this.goal.z += this.#glide[1] * elapsedMs;
      const fade = Math.exp(-elapsedMs / 320);
      // Slower than a few pixels a second, at any zoom, is stopped.
      this.#glide = Math.hypot(...this.#glide) < this.goal.distance * 0.000_004 ? [0, 0] : [this.#glide[0] * fade, this.#glide[1] * fade];
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

  /** Takes the view straight to its goal, for moves that must stay under the hand. */
  #snap(): void {
    Object.assign(this.#now, this.goal);
    this.#place();
  }

  /** Slides the map so that a point of the ground comes back under a place on the screen. */
  #pin(ground: THREE.Vector3 | undefined, clientX: number, clientY: number): void {
    const drifted = this.#under(clientX, clientY);
    if (ground === undefined || drifted === undefined) return;
    this.goal.x += ground.x - drifted.x;
    this.goal.z += ground.z - drifted.z;
    this.#snap();
  }

  /** A hand on the map stops whatever it was doing by itself, where it now is. */
  #held(): void {
    this.#ease = EASE;
    this.#glide = [0, 0];
    Object.assign(this.goal, this.#now);
  }

  #down(event: PointerEvent): void {
    this.#element.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, [event.clientX, event.clientY]);
    this.#held();
    this.#zoom.left = 0;
    this.#moved = performance.now();
    const mouse = event.pointerType === "mouse";
    this.#hold = mouse && event.button === 2 ? "zoom" : mouse && (event.button === 1 || event.shiftKey || event.ctrlKey) ? "orbit" : "drag";
    this.#pivot = { x: event.clientX, y: event.clientY, ground: this.#under(event.clientX, event.clientY) };
    if (mouse && event.button === 2) {
      if (this.#moved - this.#lastRight < DOUBLE_MS) this.#zoomSoon(event.clientX, event.clientY, Math.log(2.5));
      this.#lastRight = this.#moved;
    }
  }

  #up(event: PointerEvent): void {
    if (!this.#pointers.delete(event.pointerId)) return;
    // A hand lifted long after it last moved was resting, not throwing; and only a drag is thrown.
    if (performance.now() - this.#moved > 80 || this.#hold !== "drag") this.#glide = [0, 0];
    // The finger that stays down starts a drag of its own from where it is.
    this.#hold = "drag";
  }

  /** Turns and tilts the view about the spot the hold began on, which stays where it is on the screen. */
  #orbit(byX: number, byY: number): void {
    this.goal.bearing += byX * TURN_PER_PIXEL;
    this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt - byY * TILT_PER_PIXEL, 0, STEEPEST);
    this.#snap();
    this.#pin(this.#pivot.ground, this.#pivot.x, this.#pivot.y);
  }

  #move(event: PointerEvent): void {
    const last = this.#pointers.get(event.pointerId);
    if (last === undefined) return;
    const now = performance.now();
    const elapsed = now - this.#moved;
    this.#moved = now;
    const other = [...this.#pointers].find(([id]) => id !== event.pointerId)?.[1];
    this.#pointers.set(event.pointerId, [event.clientX, event.clientY]);
    const byX = event.clientX - last[0];
    const byY = event.clientY - last[1];

    if (other === undefined) {
      if (this.#hold === "orbit") return this.#orbit(byX, byY);
      if (this.#hold === "zoom") {
        // Drawn towards you the ground comes nearer; drawn sideways the map turns about the same spot.
        this.#zoomAbout(this.#pivot.x, this.#pivot.y, Math.exp(-byY * 0.008));
        return this.#orbit(byX * 0.6, 0);
      }
      const from = this.#under(last[0], last[1]);
      const to = this.#under(event.clientX, event.clientY);
      if (from === undefined || to === undefined) return;
      this.goal.x += from.x - to.x;
      this.goal.z += from.z - to.z;
      // The throw is the speed of the last few moves, not of one jittery one.
      if (elapsed > 0) this.#glide = [this.#glide[0] * 0.5 + ((from.x - to.x) / elapsed) * 0.5, this.#glide[1] * 0.5 + ((from.z - to.z) / elapsed) * 0.5];
      return this.#snap();
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
    this.#glide = [0, 0];
    const twist = Math.atan2(Math.sin(after.slant - before.slant), Math.cos(after.slant - before.slant));
    const sideBySide = Math.abs(Math.sin(after.slant)) < 0.5;
    const steady = Math.abs(after.spread - before.spread) < 1.5 && Math.abs(twist) < 0.012;
    // Side by side and moving up or down without spreading or twisting: that is the tilt.
    if (sideBySide && steady && Math.abs(byY) > Math.abs(byX)) {
      this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt - byY * TILT_PER_PIXEL * 0.6, 0, STEEPEST);
      return this.#snap();
    }
    // Otherwise the ground that was between the fingers stays between them, however they spread and turn.
    const held = this.#under(before.x, before.y);
    this.goal.distance = THREE.MathUtils.clamp((this.goal.distance * before.spread) / Math.max(1, after.spread), NEAREST, FARTHEST);
    this.goal.bearing -= twist;
    this.#snap();
    this.#pin(held, after.x, after.y);
  }

  /** Zooms by a factor at once, keeping the ground under a place on the screen where it is. */
  #zoomAbout(clientX: number, clientY: number, factor: number): void {
    const held = this.#under(clientX, clientY);
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * factor, NEAREST, FARTHEST);
    this.#snap();
    this.#pin(held, clientX, clientY);
  }

  /** Asks for a zoom to be played out over the coming frames, about a place on the screen. */
  #zoomSoon(clientX: number, clientY: number, logFactor: number): void {
    this.#held();
    this.#zoom = { left: this.#zoom.left + logFactor, x: clientX, y: clientY };
  }

  #wheel(event: WheelEvent): void {
    event.preventDefault();
    // A mouse wheel counts lines, a trackpad pixels, and a trackpad pinch arrives as a wheel with Ctrl held.
    const pixels = THREE.MathUtils.clamp(event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 32 : event.deltaY, -300, 300);
    if (event.shiftKey) {
      this.#held();
      this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt + pixels * 0.002, 0, STEEPEST);
      return this.#snap();
    }
    this.#zoomSoon(event.clientX, event.clientY, pixels * (event.ctrlKey ? 0.012 : 0.0028));
  }

  #key(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
    const step = this.goal.distance * 0.15;
    const ahead: [number, number] = [Math.sin(this.goal.bearing), -Math.cos(this.goal.bearing)];
    const box = this.#element.getBoundingClientRect();
    const zoom = (logFactor: number): void => this.#zoomSoon(box.left + box.width / 2, box.top + box.height / 2, logFactor);
    const go = (alongAhead: number, alongRight: number): void => {
      this.goal.x += (ahead[0] * alongAhead - ahead[1] * alongRight) * step;
      this.goal.z += (ahead[1] * alongAhead + ahead[0] * alongRight) * step;
    };
    const turn = (bearing: number, tilt: number): void => {
      this.goal.bearing += bearing;
      this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt + tilt, 0, STEEPEST);
    };
    const moves = new Map<string, () => void>([
      ["ArrowUp", () => (event.shiftKey ? turn(0, 0.12) : go(1, 0))],
      ["ArrowDown", () => (event.shiftKey ? turn(0, -0.12) : go(-1, 0))],
      ["ArrowLeft", () => (event.shiftKey ? turn(-0.15, 0) : go(0, -1))],
      ["ArrowRight", () => (event.shiftKey ? turn(0.15, 0) : go(0, 1))],
      ["+", () => zoom(Math.log(0.6))],
      ["=", () => zoom(Math.log(0.6))],
      ["-", () => zoom(Math.log(1 / 0.6))],
    ]);
    const move = moves.get(event.key);
    if (move === undefined) return;
    event.preventDefault();
    this.#ease = EASE;
    this.#glide = [0, 0];
    move();
  }
}
