import * as THREE from 'three';
import { Plant, DESIGN, type Telemetry } from './sim/plant';
import { Stage } from './view/scene';
import { World, CONTROL } from './view/world';
import { HUD } from './ui/hud';
import { Scada } from './ui/scada';
import { Welcome } from './ui/welcome';
import { Cutscene } from './ui/cutscene';
import { WalkUI } from './ui/walkui';
import { Walker, FEEL } from './view/walk';
import { SCENARIOS, applyScenario, scenarioById, type Scenario } from './scenario';

const canvas = document.getElementById('view') as HTMLCanvasElement;

// ------------------------------------------------------------------- boot
//
// Nothing is built until a scenario is chosen: the design data, the world and
// the physics all depend on it. A link with ?s=<id> goes straight in, which is
// also what a refresh does once you have picked - and what you send someone.

const params = new URLSearchParams(location.search);
const direct = scenarioById(params.get('s'));

// Paste Wars is a page of its own, loaded only by the people who ask for it:
// ?arena for the plant, ?arena=mine for the 760 Level, bake or bake-mine for tools/bake.mjs.
if (params.has('arena')) {
  const a = params.get('arena') ?? '';
  import('./arena/arena').then((m) => m.startArena(a.startsWith('bake') ? 'bake' : 'play', a.endsWith('mine') ? 'mine' : 'plant'));
} else if (direct) {
  start(direct, params.get('intro') !== '0');
} else {
  new Welcome(SCENARIOS, (s, intro) => {
    history.replaceState(null, '', '?s=' + s.id);
    start(s, intro);
  });
}

/** Back to the title screen. A fresh page is the honest way to swap worlds. */
function leaveScenario() {
  location.href = location.pathname;
}

// ------------------------------------------------------------------ start

function start(sc: Scenario, intro: boolean) {
  applyScenario(sc);
  document.documentElement.style.setProperty('--accent', sc.look.accent);
  document.title = 'PasteWorks · ' + sc.title;

  /** the opening, while it is playing - declared first, the frame loop reads it */
  let cut: Cutscene | null = null;

  const plant = new Plant();
  // There is one mode now. The fixed-feed plant still exists in the sim,
  // because the physics harnesses use it as a regression case - but anyone
  // actually playing runs the whole circuit, mill to destination.
  plant.hardMode = true;
  plant.step(0);

  const stage = new Stage(canvas);
  const world = new World(stage, sc);
  stage.scene.add(world.root);

  const hud = new HUD(plant, () => {
    plant.reset();
    world.select(null);
    hud.selectedId = null;
    hud.setSpeed(60);
    announced.clear();
  }, sc);
  hud.setSpeed(60);
  hud.onLeave = leaveScenario;

  const scada = new Scada(plant, sc);
  hud.onSetpoint = () => scada.syncSliders();
  scada.onSetpoint = () => hud.syncSliders();
  scada.onSpeed = (v) => hud.setSpeed(v);
  scada.onRun = () => hud.toggleRun();
  scada.onExit = () => sitDown(false);
  scada.onLeave = leaveScenario;

  hud.onSelect = (id) => {
    hud.selectedId = id;
    world.select(id ? world.get(id) ?? null : null);
  };

  // ------------------------------------------------------------------ on foot

  const feel = FEEL[sc.look.world];
  const walker = new Walker(stage.camera, canvas, feel);
  const walkUi = new WalkUI();
  let walking = false;
  let pausedAt = 0;
  /** Out of the control room door, facing the plant - outside the bubble, on the seabed. */
  const DOOR = new THREE.Vector3(CONTROL.x, 0.05, CONTROL.z - (sc.look.bubble ? 11.5 : 7.5));
  const WALK_FOV = 72;

  let surveying = false;

  function walk(on: boolean) {
    if (on === walking || cut?.playing || surveying) return;
    if (on) {
      sitDown(false, false);
      // The collision world is built from the plant itself, the first time
      // anyone steps out - most people never do, and it is not free. Say so,
      // let that frame paint, then build and go.
      if (!walker.ready) {
        surveying = true;
        walkUi.show(true);
        walkUi.say('Surveying the site...', 60000);
        setTimeout(() => {
          const built = walker.prepare(world.root);
          if (built) console.info(`walk: ${built.triangles} triangles in ${built.ms.toFixed(0)} ms`);
          surveying = false;
          walk(true);
        }, 60);
        return;
      }
      walking = true;
      world.select(null);
      hud.selectedId = null;
      hud.setWalking(true);
      walkUi.show(true);
      stage.controls.autoRotate = false;
      stage.controls.enabled = false;
      stage.manual = true;
      stage.onFoot(true);
      stage.camera.near = 0.15;
      stage.setFov(WALK_FOV);
      walker.enter(DOOR, 0);
      walkUi.say(feel.note);
    } else {
      walking = false;
      const eye = walker.eye, fwd = walker.forward;
      walker.exit();
      walkUi.show(false);
      hud.setWalking(false);
      world.select(null);
      hud.selectedId = null;
      stage.manual = false;
      stage.onFoot(false);
      stage.camera.near = 0.5;
      stage.setFov(SITE_FOV);
      stage.controls.enabled = true;
      // hand the orbit camera over from wherever you were standing
      stage.controls.target.copy(eye).addScaledVector(fwd, 8);
      stage.camera.position.copy(eye).addScaledVector(fwd, -10).add(new THREE.Vector3(0, 7, 0));
    }
  }
  walker.onPause = (p) => {
    pausedAt = performance.now();
    walkUi.setPaused(p);
  };
  walkUi.onResume = () => walker.lock();
  walkUi.onStop = () => walk(false);
  hud.onWalk = () => walk(true);
  scada.onWalk = () => walk(true);

  /** what the crosshair is on, if it is near enough to reach */
  const aim = () => world.pick(0, 0, 18);

  function interact() {
    const u = aim();
    if (u?.id === 'control') { walk(false); sitDown(true); return; }
    // looking at nothing, or at the thing already open: put the clipboard away
    hud.onSelect(u && u.id !== hud.selectedId ? u.id : null);
  }

  function walkPrompt() {
    const u = aim();
    walkUi.setPrompt(
      u?.id === 'control' ? '<kbd>E</kbd> take the desk'
        : u && u.id !== hud.selectedId ? '<kbd>E</kbd> inspect ' + u.name
        : hud.selectedId ? '<kbd>E</kbd> put the clipboard away'
        : null,
    );
  }

  /**
   * The site is a different shape in every world - the mass driver runs 150 m
   * out past the pad, the furrow 200 m - so the overview sits wherever the
   * whole of it fits.
   */
  const OVERVIEW: Record<string, { at: THREE.Vector3; off: THREE.Vector3 }> = {
    stope: { at: new THREE.Vector3(-40, 2, 0), off: new THREE.Vector3(-4, 62, 212) },
    launcher: { at: new THREE.Vector3(20, 14, 0), off: new THREE.Vector3(-20, 90, 300) },
    trench: { at: new THREE.Vector3(30, 0, 0), off: new THREE.Vector3(-20, 80, 260) },
    craters: { at: new THREE.Vector3(10, 4, 0), off: new THREE.Vector3(-20, 80, 230) },
  };
  const VIEWS = {
    overview: OVERVIEW[sc.look.destination],
    plant: { at: new THREE.Vector3(-18, 8, 0), off: new THREE.Vector3(-16, 30, 74) },
    upstream: { at: new THREE.Vector3(-106, 5, -4), off: new THREE.Vector3(2, 22, 58) },
  };

  // ------------------------------------------------------------ control room

  /** The operator's eye, in the chair, facing the window. */
  const EYE = new THREE.Vector3(CONTROL.x, CONTROL.eyeY, CONTROL.z + CONTROL.eyeZ);

  /** A wider lens than the site views: you are 2 m from the glass, not 70. */
  const SEAT_FOV = 60;
  const SITE_FOV = 46;

  /**
   * How far you can turn your head. Far enough to put either end wall of the
   * room square in front of you - the posters, the noticeboard, the sad plant -
   * and to look up at the warnings banner or down at your own desk.
   *
   * The hard stop is 90 deg and not negotiable: the overlay is placed with
   * tan(yaw), which is how it stays pixel-sharp, and tan blows up at a right
   * angle. 1.30 rad is 74.5 deg, which leaves the geometry comfortable and the
   * video wall well off the side of the screen by the time you get there.
   */
  const LOOK = { yaw: 1.30, up: 0.40, down: 0.42 };

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

  // ---- turning your head --------------------------------------------------

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

  function view(v: 'overview' | 'plant' | 'stope' | 'upstream') {
    const { at, off } = v === 'stope' ? world.destinationView() : VIEWS[v];
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

  // ------------------------------------------------------------------ picking

  let downAt = { x: 0, y: 0, t: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (cut?.playing) return;
    if (walking) {
      if (walker.paused) walker.lock();
      else if (e.button === 0) interact();
      return;
    }
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
    if (cut?.playing) {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cut.skip(); }
      return;
    }
    if (walking) {
      switch (e.key) {
        case ' ': e.preventDefault(); return; // jump - the walker has it
        case 'e': case 'E': if (!walker.paused) interact(); return;
        case 'r': case 'R': walker.respawn(); return;
        case 'f': case 'F': walk(false); return;
        case 'c': case 'C': walk(false); sitDown(true); return;
        // the Esc that took the mouse back is not also a request to stop
        case 'Escape': if (walker.paused && performance.now() - pausedAt > 400) walk(false); return;
        case 'o': case 'O': case 'p': case 'P': case 'u': case 'U': case 'g': case 'G':
          walk(false);
          break;
        default:
          if (!/^[1-5]$/.test(e.key)) return;
      }
    }
    switch (e.key) {
      case ' ': e.preventDefault(); hud.toggleRun(); break;
      case 'f': case 'F': walk(true); break;
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
    }
  });

  // -------------------------------------------------------------- milestones

  const announced = new Set<string>();

  function milestones(t: Telemetry) {
    if (cut?.playing) return;
    if (t.pipe.plugged && !announced.has('plug')) {
      announced.add('plug');
      hud.showBanner('LINE PLUGGED', 'Flush and re-prime before you can restart', '#ff5a3c');
    }
    if (!t.pipe.plugged) announced.delete('plug');

    if (t.status === 'complete' && !announced.has('done')) {
      announced.add('done');
      const ok = t.stope.avgUcs >= DESIGN.targetUcs;
      const n = sc.names;
      hud.showBanner(
        ok ? n.complete : n.complete + ' — UNDERSTRENGTH',
        ok
          ? `${t.stope.volume.toFixed(0)} m³ ${n.placed} at ${t.stope.avgUcs.toFixed(0)} kPa · $${t.cost.perM3.toFixed(2)}/m³`
            + (t.cost.perM3 <= sc.budget ? ' — under budget' : ' — over the $' + sc.budget + ' budget')
          : `${t.stope.avgUcs.toFixed(0)} kPa against ${DESIGN.targetUcs} kPa — ${n.failNote}`,
        ok ? '#9fe870' : '#ffab3d',
      );
      scada.announce(ok, t);
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
    if (walking) walker.update(dt);

    stage.setLook(seatedYaw, seatedPitch);
    trackLook();

    hudAccum += dt;
    if (hudAccum > 0.1) {
      hudAccum = 0;
      if (scada.open) scada.update(t, hud.speed);
      else if (!cut?.playing) hud.update(t, world.selected?.name ?? null);
      if (walking && !walker.paused) walkPrompt();
    }

    stage.render();
  }

  frame();

  // ------------------------------------------------------------------ intro
  //
  // The opening plays with the plant running, so the rakes turn, the flows
  // move and the mass driver fires while the story is told - and then resets
  // it, so the shift you are handed starts at zero, not forty minutes in.

  const takeTheSeat = () => {
    cut = null;
    plant.reset();
    hud.syncSliders();
    scada.syncSliders();
    hud.setSpeed(60);
    sitDown(true);
  };

  if (intro && sc.story.length) {
    hud.setPanelsVisible(false);
    world.setTagsVisible(false);
    stage.controls.enabled = false;
    plant.sp.running = true;
    hud.setSpeed(60);
    cut = new Cutscene(stage, sc, takeTheSeat);
    cut.play();
  } else {
    takeTheSeat();
  }

  // Handy from the browser console: PW.plant.sp, PW.stage.camera, PW.world.units
  (window as any).PW = {
    plant, stage, world, hud, scada, sitDown, CONTROL, THREE, scenario: sc, walker, walk,
    get cut() { return cut; },
    /** turn the operator's head from the console, in degrees */
    look: (yawDeg: number, pitchDeg = 0) => {
      seatedYaw = clamp((yawDeg * Math.PI) / 180, -LOOK.yaw, LOOK.yaw);
      seatedPitch = clamp(
        CONTROL.pitch + (pitchDeg * Math.PI) / 180,
        CONTROL.pitch - LOOK.down, CONTROL.pitch + LOOK.up,
      );
    },
  };
}
