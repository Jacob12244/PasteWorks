// Second half of the CAD pipeline: take the glTF Blender wrote (cad/convert.py)
// and make it small enough to send to a browser.
//
//   node cad/optimize.mjs cad/out/plant-raw.glb public/local/plant.glb [error]
//
// error is meshoptimizer's simplification limit as a fraction of each unit's
// radius. CAD tessellates every curve to machining tolerance; nobody walking
// past a pump can see below a couple of millimetres.

import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt, getSceneVertexCount, VertexCountMethod } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';

const [src, out, err = '0.0006'] = process.argv.slice(2);
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(src);
const tris = () => doc.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

const before = tris();
await doc.transform(
  // not materials: their names carry the part class, and two classes that
  // happen to share a colour must stay two classes
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: Number(err), lockBorder: false }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const after = tris();

// Nothing from the source should survive, but check rather than trust it.
doc.getRoot().getAsset().generator = 'PasteWorks CAD pipeline';
doc.getRoot().getAsset().extras = {};

await io.write(out, doc);
const verts = getSceneVertexCount(doc.getRoot().listScenes()[0], VertexCountMethod.RENDER);
const mb = (fs.statSync(out).size / 1e6).toFixed(1);
console.log(`tris ${Math.round(before)} -> ${Math.round(after)}, ${verts} verts, `
  + `${doc.getRoot().listMeshes().length} meshes, ${doc.getRoot().listMaterials().length} materials, ${mb} MB`);
