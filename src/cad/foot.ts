import * as THREE from 'three';
import { Walker, FEEL } from '../view/walk';
import { WalkUI } from '../ui/walkui';
import type { Stage } from '../view/scene';
import { survey, type Survey } from './plant';

/**
 * On foot in the converted plant: the game's own walker, on a collision world
 * built from the CAD meshes the first time someone steps out.
 *
 * F drops you in wherever the middle of the screen is pointing - on the
 * nearest floor in front of whatever is there - so you can fly the orbit
 * camera over to the pumps and walk from there. H takes you to the control
 * room door, which is on the top floor.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WALK_FOV = 72;
/** how far off the crosshair still names what it is on */
const REACH = 14;
/**
 * What you can stand on: plate and slabs, the ground, the landing decks the
 * converter adds - and steel, where it is deck. The top of a beam is level too.
 */
const FLOOR = new Set(['grating', 'concrete', 'ground', 'ramp', 'steel']);
/** On foot, the shadow map covers this far either side of you, redrawn every SNAP metres. */
const SHADOW = 60, SNAP = 10;

/** The first thing on the line a -> b, walked in short pieces so each look-up stays small. */
function cast(s: Survey, a: THREE.Vector3, b: THREE.Vector3) {
  const d = V().subVectors(b, a);
  const n = Math.max(1, Math.ceil(d.length() / 1.5));
  const p = V(), q = V();
  for (let k = 0; k < n; k++) {
    p.copy(a).addScaledVector(d, k / n);
    q.copy(a).addScaledVector(d, (k + 1) / n);
    const h = s.grid.segment(p.x, p.y, p.z, q.x, q.y, q.z);
    if (h) return { at: p.lerp(q, h.t), normal: V(h.nx, h.ny, h.nz), ...s.owner(s.grid.hit) };
  }
  return null;
}

/** The floor under a point - if there is one to stand on, and not the top of a pump or a beam. */
function floorUnder(s: Survey, p: THREE.Vector3) {
  const h = cast(s, p, V(p.x, p.y - 80, p.z));
  if (!h || !FLOOR.has(h.cls) || h.normal.y < 0.6) return null;
  if (h.cls === 'ground' || h.cls === 'concrete') return h.at;
  // A deck is still there a quarter of a metre off to the sides, at the same
  // height. A beam's top flange is there along the beam and not across it;
  // the end of a landing deck is there on three sides out of four.
  let deck = 0;
  for (const [dx, dz] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
    const o = cast(s, V(h.at.x + dx, h.at.y + 0.3, h.at.z + dz), V(h.at.x + dx, h.at.y - 0.3, h.at.z + dz));
    if (o && Math.abs(o.at.y - h.at.y) < 0.1) deck++;
  }
  return deck >= 3 ? h.at : null;
}

/** What a unit is called out loud: pd_concrete_pump_2 is a PD concrete pump. */
function label(unit: string): string | null {
  // floors, stairs, bridges and pipework are everywhere; naming them is noise
  if (!unit || /^(slab|stair|pipe_bridge|high_level_bridge|drive_in|all_pipes|person|walk_aids)/.test(unit)) return null;
  const s = unit.replace(/^untagged_/, '').replace(/_\d+$/, '').replace(/_/g, ' ')
    .replace(/\b(pd|hp|dn\d+)\b/g, (w) => w.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function onFoot(opts: {
  stage: Stage;
  model: THREE.Object3D;
  ground: THREE.Mesh;
  units: Record<string, THREE.Object3D>;
  reshadow: () => void;
}) {
  const { stage, model, ground, units, reshadow } = opts;
  const canvas = stage.renderer.domElement;
  // a person's width, not the game's: real walkways are 0.6 m between handrails
  const walker = new Walker(stage.camera, canvas, FEEL.earth, 0.25);
  // CAD headroom is what the steel left, not what a game would give you
  walker.duck = true;
  const ui = new WalkUI();
  document.querySelector('#walk .keys')!.innerHTML =
    '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &middot; <kbd>Shift</kbd> run &middot; '
    + '<kbd>Space</kbd> jump &middot; <kbd>R</kbd> back to where you started &middot; '
    + '<kbd>H</kbd> control room &middot; <kbd>X</kbd> cladding &middot; <kbd>F</kbd> stop walking';
  document.querySelector('#walk .card p')!.innerHTML = 'Click to carry on walking, or <kbd>Esc</kbd> to stop.';

  let s: Survey | null = null;
  let walking = false, surveying = false, pausedAt = 0, since = 0, siteFov = stage.camera.fov;

  const plant = new THREE.Box3().setFromObject(model);
  const mid = plant.getCenter(V());

  /**
   * Out of the control room door, facing the plant. The door is not in the
   * model, so it is wherever there is floor at the room's own level, on the
   * side nearest the middle of the plant.
   */
  function home(sv: Survey) {
    const room = units.control_room;
    if (room) {
      const box = new THREE.Box3().setFromObject(room);
      const c = box.getCenter(V()), half = box.getSize(V()).multiplyScalar(0.5);
      const toPlant = V(mid.x - c.x, 0, mid.z - c.z).normalize();
      let best: { at: THREE.Vector3; yaw: number } | null = null, score = -Infinity;
      for (let i = 0; i < 24; i++) {
        const d = V(Math.cos((i / 12) * Math.PI), 0, Math.sin((i / 12) * Math.PI));
        const out = Math.min(half.x / Math.max(Math.abs(d.x), 1e-6), half.z / Math.max(Math.abs(d.z), 1e-6)) + 1.2;
        const f = floorUnder(sv, c.clone().addScaledVector(d, out).setY(box.min.y + 1.2));
        if (!f || Math.abs(f.y - box.min.y) > 0.8 || d.dot(toPlant) <= score) continue;
        score = d.dot(toPlant);
        best = { at: f, yaw: Math.atan2(-d.x, -d.z) };
      }
      if (best) return best;
    }
    // no control room, or no floor round it: the ground outside it
    const box = room ? new THREE.Box3().setFromObject(room) : plant;
    const c = box.getCenter(V());
    const half = box.getSize(V()).multiplyScalar(0.5);
    // which way the plant is from the door; with no control room, the door
    // is the south edge of the whole plant and the plant is north of it
    const d = V(mid.x - c.x, 0, mid.z - c.z);
    if (!room || d.lengthSq() < 1) d.set(0, 0, -1);
    d.normalize();
    const out = Math.min(half.x / Math.max(Math.abs(d.x), 1e-6), half.z / Math.max(Math.abs(d.z), 1e-6)) + 2.5;
    const p = c.clone().addScaledVector(d, room ? out : -out).setY(box.min.y + 3);
    return { at: floorUnder(sv, p) ?? V(p.x, 0, p.z), yaw: Math.atan2(-d.x, -d.z) };
  }

  /**
   * Where the middle of the screen is: on it, if it is a floor; otherwise on
   * the first floor back towards the camera from it. Looking at the side of a
   * tank puts you on the ground in front of the tank, not in it or on it.
   */
  function dropIn(sv: Survey) {
    const cam = stage.camera;
    const dir = cam.getWorldDirection(V());
    const yaw = Math.atan2(-dir.x, -dir.z);
    const hit = cast(sv, cam.position, cam.position.clone().addScaledVector(dir, 600));
    if (!hit) return null;
    const on = hit.normal.y > 0.6 && floorUnder(sv, hit.at.clone().setY(hit.at.y + 0.2));
    if (on) return { at: on, yaw };
    for (let k = 1; k <= 40; k++) {
      const f = floorUnder(sv, hit.at.clone().addScaledVector(dir, -1.2 * k));
      if (f) return { at: f, yaw };
    }
    return null;
  }

  // Close up, the whole-plant shadow map is 11 cm a texel and looks it. On
  // foot it covers the ground round you instead, and moves when you do.
  const key = stage.key;
  const shadowCam = key.shadow.camera;
  const sun = key.position.clone().sub(key.target.position);
  const wide = shadowCam.right;
  const shadowAt = V(NaN, 0, 0);
  function aimShadow(near: boolean, at = V()) {
    const r = near ? SHADOW : wide;
    const c = near ? V(Math.round(at.x / SNAP) * SNAP, 0, Math.round(at.z / SNAP) * SNAP) : V();
    if (c.equals(shadowAt) && shadowCam.right === r) return;
    shadowAt.copy(c);
    shadowCam.left = shadowCam.bottom = -r;
    shadowCam.right = shadowCam.top = r;
    shadowCam.updateProjectionMatrix();
    key.target.position.copy(c);
    key.target.updateMatrixWorld();
    key.position.copy(c).add(sun);
    reshadow();
  }

  function set(on: boolean) {
    if (on === walking || surveying) return;
    if (on) {
      // Built the first time anyone steps out, not on load: most people who
      // open the page never do. Say so, let that frame paint, then build.
      if (!s) {
        surveying = true;
        ui.show(true);
        ui.say('Surveying the plant...', 60000);
        setTimeout(() => {
          const t0 = performance.now();
          s = survey(model, ground);
          walker.useWorld(s.grid);
          console.info(`walk: ${s.grid.size} triangles in ${(performance.now() - t0).toFixed(0)} ms`);
          surveying = false;
          set(true);
        }, 60);
        return;
      }
      const spot = dropIn(s) ?? home(s);
      walking = true;
      siteFov = stage.camera.fov;
      stage.controls.autoRotate = false;
      stage.controls.enabled = false;
      stage.manual = true;
      stage.camera.near = 0.15;
      stage.setFov(WALK_FOV);
      stage.onFoot(true);
      walker.enter(spot.at.add(V(0, 0.05, 0)), spot.yaw);
      ui.show(true);
      ui.say(FEEL.earth.note);
      aimShadow(true, walker.feet);
    } else {
      walking = false;
      const eye = walker.eye, fwd = walker.forward;
      walker.exit();
      ui.setPrompt(null);
      ui.show(false);
      stage.manual = false;
      stage.camera.near = 0.5;
      stage.setFov(siteFov);
      stage.onFoot(false);
      stage.controls.enabled = true;
      // hand the orbit camera over from wherever you were standing
      stage.controls.target.copy(eye).addScaledVector(fwd, 8);
      stage.camera.position.copy(eye).addScaledVector(fwd, -10).add(V(0, 7, 0));
      aimShadow(false);
    }
  }

  walker.onPause = (p) => {
    pausedAt = performance.now();
    ui.setPaused(p);
  };
  ui.onResume = () => walker.lock();
  ui.onStop = () => set(false);
  canvas.addEventListener('pointerup', () => {
    if (walking && walker.paused) walker.lock();
  });

  /** Handle a key if it is ours; false leaves it to the viewer. */
  function onKey(e: KeyboardEvent): boolean {
    if (surveying) return true;
    if (!walking) {
      if (e.key !== 'f' && e.key !== 'F') return false;
      set(true);
      return true;
    }
    switch (e.key) {
      case ' ': e.preventDefault(); return true; // jump - the walker has it
      case 'f': case 'F': set(false); return true;
      case 'r': case 'R': walker.respawn(); return true;
      case 'h': case 'H': { const h = home(s!); walker.teleport(h.at.add(V(0, 0.05, 0)), h.yaw); return true; }
      // the Esc that took the mouse back is not also a request to stop
      case 'Escape': if (walker.paused && performance.now() - pausedAt > 400) set(false); return true;
      case 'x': case 'X': case 'l': case 'L': return false;
      default:
        // a view key: off your feet, and let the viewer fly there
        if (/^[1-4]$/.test(e.key)) { set(false); return false; }
        return true;
    }
  }

  /** Name whatever the crosshair is on, if it is near enough to matter. */
  function prompt() {
    const cam = stage.camera;
    const h = cast(s!, cam.position, cam.position.clone().addScaledVector(cam.getWorldDirection(V()), REACH));
    ui.setPrompt(h ? label(h.unit) : null);
  }

  function update(dt: number) {
    if (!walking) return;
    walker.update(dt);
    aimShadow(true, walker.feet);
    since += dt;
    if (since > 0.1) {
      since = 0;
      if (!walker.paused) prompt();
    }
  }

  return {
    get walking() { return walking; },
    /** the collision world, once someone has stepped out - for cad/walk.mjs */
    get survey() { return s; },
    set, onKey, update, walker,
    say: (text: string) => ui.say(text),
  };
}
