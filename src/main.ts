import * as THREE from 'three';
import { Plant, DESIGN, type Telemetry } from './sim/plant';
import { Stage } from './view/scene';
import { World, CONTROL } from './view/world';
import { HUD } from './ui/hud';
import { Scada } from './ui/scada';

const canvas = document.getElementById('view') as HTMLCanvasElement;

const plant = new Plant();
const stage = new Stage(canvas);
const world = new World(stage);
stage.scene.add(world.root);

const hud = new HUD(plant, () => {
  plant.reset();
  world.select(null);
  hud.selectedId = null;
  hud.setSpeed(60);
  announced.clear();
});
hud.setSpeed(60);

const scada = new Scada(plant);
hud.onSetpoint = () => scada.syncSliders();
scada.onSetpoint = () => hud.syncSliders();
scada.onSpeed = (v) => hud.setSpeed(v);
scada.onRun = () => hud.toggleRun();
scada.onExit = () => sitDown(false);

hud.onSelect = (id) => {
  hud.selectedId = id;
  world.select(id ? world.get(id) ?? null : null);
};

const VIEWS = {
  overview: { at: new THREE.Vector3(11, -14, 0), off: new THREE.Vector3(-46, 56, 104) },
  plant: { at: new THREE.Vector3(-18, 8, 0), off: new THREE.Vector3(-16, 30, 74) },
  overviewHard: { at: new THREE.Vector3(-40, 2, 0), off: new THREE.Vector3(-4, 62, 212) },
  upstream: { at: new THREE.Vector3(-106, 5, -4), off: new THREE.Vector3(2, 22, 58) },
  stope: { at: new THREE.Vector3(58, -40, 0), off: new THREE.Vector3(-44, 26, 68) },
} as const;

// ------------------------------------------------------------ control room

/**
 * Sitting at the desk.
 *
 * The camera parks just outside the glass, level with the operator's eye and
 * looking out across the plant, and orbit is locked so the framing stays the
 * shot it was designed as. The SCADA overlay then draws on top of it, with a
 * transparent band where the window is.
 */
/** The operator's eye, in the chair, facing the window. */
const EYE = new THREE.Vector3(CONTROL.x, CONTROL.eyeY, CONTROL.z + CONTROL.eyeZ);

/** A wider lens than the site views: you are 2 m from the glass, not 70. */
const SEAT_FOV = 60;
const SITE_FOV = 46;

/**
 * How far you can turn your head. You are in a chair, not walking about, so
 * the range is generous enough to look along the window and down at the desk
 * and no further - which also keeps the physical controls on the desk from
 * ever leaving the screen.
 */
const LOOK = { yaw: 0.52, up: 0.30, down: 0.34 };

let seatedYaw = 0;
let seatedPitch = CONTROL.pitch;

function sitDown(on: boolean, fly = true) {
  if (on === scada.open) return;
  world.setTagsVisible(!on);
  world.setSeated(on);

  if (on) {
    world.select(null);
    hud.selectedId = null;
    stage.controls.autoRotate = false;
    stage.controls.enabled = false;
    stage.setFov(SEAT_FOV);

    // Fly to the chair first, then hand over to free look at exactly the
    // orientation the flight ended on, so the switch is invisible.
    const fwd = new THREE.Vector3(0, Math.sin(CONTROL.pitch), -Math.cos(CONTROL.pitch));
    const target = EYE.clone().addScaledVector(fwd, 20);
    stage.flyTo(target, EYE.clone().sub(target), 1100);
    setTimeout(() => {
      if (!scada.open) return;
      seatedYaw = 0;
      seatedPitch = CONTROL.pitch;
      stage.enterFreeLook(EYE, CONTROL.pitch);
    }, 1120);

    scada.show();
    hud.setPanelsVisible(false);
  } else {
    stage.exitFreeLook();
    stage.setFov(SITE_FOV);
    scada.hide();
    scada.setLookOffset(0, 0);
    hud.setPanelsVisible(true);
    stage.controls.enabled = true;
    // the caller flies somewhere itself when it has a view in mind; two
    // flyTo tweens running at once would fight each other
    if (fly) view('plant');
  }
}

// ---- turning your head ----------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

let look = { active: false, x: 0, y: 0, yaw: 0, pitch: 0 };

scada.root.addEventListener('pointerdown', (e) => {
  // never steal a drag that belongs to a slider or a button
  if ((e.target as HTMLElement).closest('input, button, a, select, textarea')) return;
  // stop the browser turning the drag into a text selection across the panels
  e.preventDefault();
  look = { active: true, x: e.clientX, y: e.clientY, yaw: seatedYaw, pitch: seatedPitch };
  try { scada.root.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
  scada.root.classList.add('dragging');
});

scada.root.addEventListener('pointermove', (e) => {
  if (!look.active) return;
  // drag the room, not the head: pulling right swings the view left
  const K = 0.0013;
  seatedYaw = clamp(look.yaw + (e.clientX - look.x) * K, -LOOK.yaw, LOOK.yaw);
  seatedPitch = clamp(
    look.pitch + (e.clientY - look.y) * K,
    CONTROL.pitch - LOOK.down, CONTROL.pitch + LOOK.up,
  );
});

const endLook = (e: PointerEvent) => {
  if (!look.active) return;
  look.active = false;
  try { scada.root.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
  scada.root.classList.remove('dragging');
};
scada.root.addEventListener('pointerup', endLook);
scada.root.addEventListener('pointercancel', endLook);

scada.onCentre = () => { seatedYaw = 0; seatedPitch = CONTROL.pitch; };

/**
 * Keep the furniture bolted to the room.
 *
 * The camera only ever rotates in the chair, and under pure rotation every
 * direction in the world shifts by the same angle - so reproducing it for the
 * overlay is a translation of exactly tan(angle) / tan(half FOV) of the frame.
 */
function trackLook() {
  if (!scada.open || !stage.freeLook) return;
  const { yaw, pitch } = stage.look;
  const tanV = Math.tan((stage.camera.fov * Math.PI) / 360);
  const tanH = tanV * stage.camera.aspect;
  scada.setLookOffset(
    (Math.tan(yaw) / tanH) * (innerWidth / 2),
    (Math.tan(pitch - CONTROL.pitch) / tanV) * (innerHeight / 2),
  );
}

function view(v: keyof typeof VIEWS) {
  // the hard-mode site is 130 m longer, so it needs its own overview
  const key = v === "overview" && plant.hardMode ? "overviewHard" : v;
  const { at, off } = VIEWS[key];
  stage.controls.autoRotate = false;
  stage.flyTo(at, off);
  world.select(null);
  hud.selectedId = null;
}
hud.onView = (v) => {
  if (v === 'control') { sitDown(true); return; }
  sitDown(false, false);
  view(v);
};
hud.onModeChange = () => { if (!scada.open) view('overview'); };

// ------------------------------------------------------------------ picking

let downAt = { x: 0, y: 0, t: 0 };
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  // ignore the pointerup that ends an orbit drag
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  if (moved > 5 || performance.now() - downAt.t > 450) return;

  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = -(e.clientY / innerHeight) * 2 + 1;
  const u = world.pick(nx, ny);
  if (u?.id === 'control') { sitDown(true); return; }
  world.select(u);
  hud.selectedId = u?.id ?? null;
});

// ---------------------------------------------------------------- shortcuts

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ': e.preventDefault(); hud.toggleRun(); break;
    case '1': hud.setSpeed(0); break;
    case '2': hud.setSpeed(1); break;
    case '3': hud.setSpeed(10); break;
    case '4': hud.setSpeed(60); break;
    case '5': hud.setSpeed(240); break;
    case 'Escape':
      if (scada.open) sitDown(false);
      else { world.select(null); hud.selectedId = null; }
      break;
    case 'c': case 'C': sitDown(!scada.open); break;
    // a view shortcut gets you out of the chair first, or the camera would
    // fly off while the video wall was still up and orbit still locked
    case 'o': case 'O': sitDown(false, false); view('overview'); break;
    case 'p': case 'P': sitDown(false, false); view('plant'); break;
    case 'u': case 'U': sitDown(false, false); view('stope'); break;
    case 'g': case 'G': sitDown(false, false); view('upstream'); break;
    case 'h': case 'H': hud.setHard(!plant.hardMode); break;
  }
});

// -------------------------------------------------------------- milestones

const announced = new Set<string>();

function milestones(t: Telemetry) {
  if (t.pipe.plugged && !announced.has('plug')) {
    announced.add('plug');
    hud.showBanner('LINE PLUGGED', 'Flush and re-prime before you can restart', '#ff5a3c');
  }
  if (!t.pipe.plugged) announced.delete('plug');

  if (t.status === 'complete' && !announced.has('done')) {
    announced.add('done');
    const ok = t.stope.avgUcs >= DESIGN.targetUcs;
    hud.showBanner(
      ok ? 'STOPE FILLED' : 'STOPE FILLED — UNDERSTRENGTH',
      ok
        ? `${t.stope.volume.toFixed(0)} m³ at ${t.stope.avgUcs.toFixed(0)} kPa · $${t.cost.perM3.toFixed(2)}/m³ · ${t.blockages} blockages`
        : `${t.stope.avgUcs.toFixed(0)} kPa against a ${DESIGN.targetUcs} kPa target — the pillar will not stand`,
      ok ? '#9fe870' : '#ffab3d',
    );
    plant.sp.running = false;
  }
}

// -------------------------------------------------------------- frame loop

const clock = new THREE.Clock();
let hudAccum = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);

  // advance the process in bounded sub-steps so fast-forward stays stable
  const simSeconds = dt * hud.speed;
  if (simSeconds > 0) {
    const steps = Math.min(40, Math.max(1, Math.ceil(simSeconds / 6)));
    const h = simSeconds / steps;
    for (let i = 0; i < steps; i++) plant.step(h);
  } else {
    plant.step(0);
  }

  const t = plant.telemetry;
  world.update(t, dt);
  milestones(t);

  stage.setLook(seatedYaw, seatedPitch);
  trackLook();

  hudAccum += dt;
  if (hudAccum > 0.1) {
    hudAccum = 0;
    if (scada.open) scada.update(t, hud.speed);
    else hud.update(t, world.selected?.name ?? null);
  }

  stage.render();
}

frame();

// open on a slow orbit so the plant introduces itself
let intro = 0;
const introSpin = setInterval(() => {
  if (++intro > 60 || world.selected) { clearInterval(introSpin); return; }
  stage.controls.autoRotate = true;
  stage.controls.autoRotateSpeed = 0.35;
}, 50);
canvas.addEventListener('pointerdown', () => {
  stage.controls.autoRotate = false;
  clearInterval(introSpin);
}, { once: true });

// Handy from the browser console: PW.plant.sp, PW.stage.camera, PW.world.units
(window as any).PW = {
  plant, stage, world, hud, scada, sitDown, CONTROL, THREE,
  /** turn the operator's head from the console, in degrees */
  look: (yawDeg: number, pitchDeg = 0) => {
    seatedYaw = clamp((yawDeg * Math.PI) / 180, -LOOK.yaw, LOOK.yaw);
    seatedPitch = clamp(
      CONTROL.pitch + (pitchDeg * Math.PI) / 180,
      CONTROL.pitch - LOOK.down, CONTROL.pitch + LOOK.up,
    );
  },
};
