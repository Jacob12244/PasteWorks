import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Everything that stands still in the level, flattened.
 *
 * The dressing is written the easy way - a mine car is a group of boxes, a
 * lamp is a tube on two chains - which comes to a few thousand meshes. Drawn
 * like that it would be a few thousand draw calls. So it is all taken into a
 * kit instead: every mesh put into world space and filed by its material and
 * by whether it collides, then each pile merged into one mesh. A few dozen
 * draw calls, and one world-space geometry each for the light bake to walk.
 */
export class Kit {
  private piles = new Map<string, { mat: THREE.Material; collide: boolean; geos: THREE.BufferGeometry[] }>();

  /** Take in every mesh under o, where it stands now. */
  take(o: THREE.Object3D) {
    o.updateWorldMatrix(true, true);
    const m = new THREE.Matrix4();
    const visit = (n: THREE.Object3D, solid: boolean) => {
      if (!n.visible) return;
      const collide = solid && !n.userData.noCollide;
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
        const inst = mesh as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          for (let i = 0; i < inst.count; i++) {
            inst.getMatrixAt(i, m);
            m.premultiply(inst.matrixWorld);
            this.add(mesh.geometry, mat, m, collide && !!mesh.userData.solid);
          }
        } else {
          this.add(mesh.geometry, mat, mesh.matrixWorld, collide || !!mesh.userData.collider);
        }
      }
      for (const c of n.children) visit(c, collide);
    };
    visit(o, true);
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, world: THREE.Matrix4, collide: boolean) {
    // see-through things never collide, whatever they are part of
    if (mat.transparent) collide = false;
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(world);
    const keepUv = !!(mat as THREE.MeshStandardMaterial).map;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && !(keepUv && name === 'uv')) g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (keepUv && !g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    g.morphAttributes = {};
    const key = mat.uuid + (collide ? ':c' : ':n');
    const pile = this.piles.get(key);
    if (pile) pile.geos.push(g);
    else this.piles.set(key, { mat, collide, geos: [g] });
    g = null!;
  }

  /** One mesh a pile. Anything that does not collide says so. */
  build(): THREE.Group {
    const out = new THREE.Group();
    out.name = 'mine-kit';
    for (const { mat, collide, geos } of this.piles.values()) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      if (!mat.visible) mesh.userData.collider = true;
      else if (!collide) mesh.userData.noCollide = true;
      out.add(mesh);
    }
    this.piles.clear();
    return out;
  }
}
