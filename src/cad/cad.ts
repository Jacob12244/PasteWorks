import * as THREE from 'three';
import { Stage } from '../view/scene';
import { scenarioById } from '../scenario';
import { loadPlant, looks, SUN, PLANT_URL } from './plant';
import { onFoot } from './foot';

/**
 * ?cad - a real plant, converted from CAD by cad/convert.py and
 * cad/optimize.mjs, standing on the PasteWorks stage under the same sky and
 * lights as the `today` world. A test bench: it answers "does it look right
 * and does it run", before anything is wired to the sim.
 *
 * The model is local only (public/local/, excluded from git).
 */

export async function startCad() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const sc = scenarioById('today')!;
  const stage = new Stage(canvas);
  const params = new URLSearchParams(location.search);
  const LOOKS = looks(sc.look);
  let look: 'dusk' | 'day' = params.get('look') === 'day' ? 'day' : 'dusk';
  stage.applyLook(LOOKS[look]);
  stage.key.position.copy(SUN);
  document.title = 'PasteWorks · CAD test';
  document.documentElement.style.setProperty('--accent', sc.look.accent);

  const info = document.createElement('div');
  info.id = 'cad-info';
  info.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:10;padding:10px 12px;'
    + 'font:12px/1.5 ui-monospace,monospace;color:#cfe;background:#0b111bcc;'
    + 'border:1px solid #2f6f74;border-radius:8px;white-space:pre;pointer-events:none';
  info.textContent = 'loading plant...';
  document.body.appendChild(info);

  const plant = await loadPlant({ ramps: params.has('ramps') });
  if (!plant) {
    info.textContent = `no model at ${PLANT_URL}
run cad/convert.py and cad/optimize.mjs first`;
    return;
  }
  const { model, ground, units, cladding, bytes, fetchMs, parseMs } = plant;
  stage.scene.add(ground, model);

  // Nothing here moves and neither does the sun, so draw the shadow map once
  // rather than every frame - it is a second pass over every triangle.
  const r = stage.renderer;
  r.shadowMap.autoUpdate = false;
  const reshadow = () => { r.shadowMap.needsUpdate = true; };
  reshadow();
  // ?pr=1 renders at one pixel per CSS pixel, for weaker GPUs on hi-dpi screens
  if (params.has('pr')) {
    r.setPixelRatio(Number(params.get('pr')) || 1);
    stage.resize();
  }
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    .replace(/^ANGLE ((.*))$/, '$1').replace(/s*(0x[0-9A-F]+)|Direct3D.*$/gi, '').trim();

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());

  const views: Record<string, { at: THREE.Vector3; off: THREE.Vector3 }> = {
    '1': { at: mid.clone().setY(6), off: new THREE.Vector3(-70, 55, 95) },
    '2': { at: mid.clone().setY(8), off: new THREE.Vector3(80, 35, 60) },
    '3': { at: mid.clone().setY(4), off: new THREE.Vector3(10, 18, -55) },
    '4': { at: mid.clone().setY(2), off: new THREE.Vector3(-25, 8, 30) },
  };
  const go = (k: string, ms = 900) => views[k] && stage.flyTo(views[k].at, views[k].off, ms);
  stage.controls.target.copy(views['1'].at);
  stage.camera.position.copy(views['1'].at).add(views['1'].off);
  // walls and roof off by default: the plant is the point, not the shed
  let clad = params.get('clad') === '1';
  const foot = onFoot({ stage, model, ground, units, reshadow });
  const setClad = (on: boolean) => {
    clad = on;
    for (const m of cladding) m.visible = on;
    reshadow();
    if (on && foot.walking) foot.say('Walls and roofs are for looking at - you can walk straight through them.');
  };
  setClad(clad);
  const setLook = (l: 'dusk' | 'day') => { look = l; stage.applyLook(LOOKS[l]); reshadow(); };
  addEventListener('keydown', (e) => {
    if (foot.onKey(e)) return;
    if (e.key === 'x' || e.key === 'X') setClad(!clad);
    else if (e.key === 'l' || e.key === 'L') setLook(look === 'day' ? 'dusk' : 'day');
    else go(e.key);
  });

  // ---- the numbers that decide whether this can ship
  let frames = 0, last = performance.now(), fps = 0;
  const mb = (bytes / 1e6).toFixed(1);
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    foot.update(Math.min(clock.getDelta(), 0.1));
    stage.renderer.info.reset();
    stage.render();
    frames++;
    const now = performance.now();
    if (now - last > 500) {
      fps = (frames * 1000) / (now - last);
      frames = 0; last = now;
      const ri = stage.renderer.info.render;
      info.textContent =
        `CAD test · ${Object.keys(units).length} units · ${size.x.toFixed(0)} x ${size.z.toFixed(0)} x ${size.y.toFixed(0)} m\n`
        + `file ${mb} MB · fetch ${fetchMs.toFixed(0)} ms · decode ${parseMs.toFixed(0)} ms\n`
        + `${(ri.triangles / 1e6).toFixed(2)} M tris/frame · ${ri.calls} draw calls · ${fps.toFixed(0)} fps\n`
        + `${gpu} · ${r.domElement.width} x ${r.domElement.height} px (x${r.getPixelRatio()})
`
        + `views: 1 2 3 4 · F walk from here · X cladding (${clad ? 'on' : 'off'}) · L look (${look})`;
    }
  }
  stage.renderer.info.autoReset = false;
  frame();

  (window as any).CAD = { stage, model, units, views, go, setClad, setLook, foot, THREE };
}
