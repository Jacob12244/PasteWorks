"""Import a plant FBX once, save a .blend, and report what is in it."""
import bpy, sys, re, collections, mathutils

args = sys.argv[sys.argv.index('--') + 1:]
src, blend = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.fbx_import(filepath=src)
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)

def kind(name):
    return re.sub(r'[\.\d_ ]+$', '', name)

def colour(mat):
    if mat is None:
        return None
    if mat.use_nodes and mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                c = n.inputs['Base Color'].default_value
                return tuple(round(v, 3) for v in c[:3])
    return tuple(round(v, 3) for v in mat.diffuse_color[:3])

objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
by_kind = collections.defaultdict(lambda: [0, 0])
by_col = collections.defaultdict(lambda: [0, 0])
sizes = collections.Counter()
size_tris = collections.Counter()
props = collections.Counter()
for o in objs:
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    k = kind(o.name)
    by_kind[k][0] += 1; by_kind[k][1] += t
    mats = {colour(s.material) for s in o.material_slots} or {None}
    for c in mats:
        by_col[c][0] += 1; by_col[c][1] += t
    d = o.dimensions.length
    b = '<0.05' if d < 0.05 else '<0.1' if d < 0.1 else '<0.2' if d < 0.2 else '<0.5' if d < 0.5 else '<2' if d < 2 else '<10' if d < 10 else '>=10'
    sizes[b] += 1; size_tris[b] += t
    for key in o.keys():
        props[key] += 1

print('KINDS')
for k, (n, t) in sorted(by_kind.items(), key=lambda x: -x[1][1]):
    print(f'  {k:40s} {n:6d} obj {t:9d} tris')
print('COLOURS', len(by_col))
for c, (n, t) in sorted(by_col.items(), key=lambda x: -x[1][1])[:40]:
    print(f'  {c} {n:6d} obj {t:9d} tris')
print('SIZES (bbox diagonal, m)')
for b in ['<0.05', '<0.1', '<0.2', '<0.5', '<2', '<10', '>=10']:
    print(f'  {b:6s} {sizes[b]:6d} obj {size_tris[b]:9d} tris')
print('CUSTOM PROPS', props.most_common(20))
sample = [o for o in objs if o.keys()][:3]
for o in sample:
    print('  e.g.', o.name, {k: str(o[k])[:80] for k in o.keys()})
print('NON-MESH', collections.Counter(o.type for o in bpy.context.scene.objects if o.type != 'MESH'))
print('SCENE/COLLECTIONS', bpy.context.scene.name, [c.name for c in bpy.data.collections][:10])
