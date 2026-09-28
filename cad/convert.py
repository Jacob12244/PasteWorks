"""
Turn a plant CAD export (FBX from Navisworks / Plant 3D, opened once and saved
as .blend by survey.py) into a web-sized glTF for PasteWorks.

  blender -b plant.blend -P cad/convert.py -- out.glb [report.json]

What comes out has no names from the source. Every node is a unit key made
from the equipment description with the tag number dropped (slag_silo_3,
thickener, pd_concrete_pump_2), and every material is a part class
(handrail, pipe, steel, concrete, equip) carrying the CAD colour, which the
page turns into real materials. The source file name, project number and
equipment tags never reach the output.
"""
import bpy, bmesh, sys, re, json, math, time, collections, mathutils
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
REPORT = args[1] if len(args) > 1 else None

MIN_SIZE = 0.10          # m, bounding-box diagonal: bolts, nuts, washers
WELD = 0.001             # m
SMOOTH_ANGLE = math.radians(35)
DROP_KINDS = {'DIMENSION', 'Region'}
# grating comes through as its bars, strips on edge that look like lines; see 3a
DECK_KINDS = {'Line Set', 'PolyLine'}

t0 = time.time()
stats = collections.Counter()


def log(msg):
    print(f'[{time.time() - t0:7.1f}s] {msg}', flush=True)


def kind(name):
    return re.sub(r'[\.\d_ ]+$', '', name)


def unit_of(o):
    """The equipment or area an object belongs to: the second empty down."""
    names = []
    p = o.parent
    while p:
        names.append(p.name)
        p = p.parent
    names.reverse()
    return names[1] if len(names) >= 2 else (names[0] if names else 'misc')


def slug(unit):
    s = re.sub(r'\.\d{3}$', '', unit)
    s = re.sub(r'^\s*\d+-[A-Za-z]+-\d+\s*[_ ]*', '', s)   # 01-SI-010 → ''
    s = re.sub(r'^3D\s+', '', s)
    s = re.sub(r'_\d+$', '', s)
    s = s.replace('PD_', 'PD').replace('H.P.', 'HP')
    s = re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_').lower()
    return s or 'misc'


def colour(mat):
    if mat is None:
        return (0.8, 0.8, 0.8)
    if mat.use_nodes and mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                return tuple(round(v, 3) for v in n.inputs['Base Color'].default_value[:3])
    return tuple(round(v, 3) for v in mat.diffuse_color[:3])


def ancestry(o):
    names = []
    p = o.parent
    while p:
        names.append(p.name.lower()); p = p.parent
    return ' / '.join(reversed(names))


def panel(o):
    """
    'wall' or 'flat' for a sheet that is thin and wide both ways, else None.
    Thin is relative - a pitched roof's box is as deep as its rise, 0.6 m over
    a 13 m span. Which way the thin side faces in the world decides wall from
    floor or roof.
    """
    dims = list(o.dimensions)
    d = sorted(dims)
    if not (d[1] > 4 and d[2] > 4 and d[0] < max(0.3, min(1.5, 0.1 * d[1]))):
        return None
    axis = mathutils.Vector([1.0 if i == dims.index(d[0]) else 0.0 for i in range(3)])
    up = (o.matrix_world.to_3x3() @ axis).normalized()
    return 'flat' if abs(up.z) > 0.7 else 'wall'


def world_box(o):
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    return (mathutils.Vector([min(w[i] for w in ws) for i in range(3)]),
            mathutils.Vector([max(w[i] for w in ws) for i in range(3)]))


# vessels have flat lids that look like panels and are not
VESSEL = re.compile(r'tank|silo|thickener|hopper')
# the top of each big open vessel's shell, filled in once units are known
shell_top = {}


unit_top = {}


def is_cover(o, unit_key):
    """
    What sits over a big open vessel: a wide shallow roof on the shell, and
    the sheets capping whatever is highest (the bridge enclosure's roof).
    The bridge truss and drive platform under them stay.
    """
    if unit_key not in shell_top:
        return False
    lo, hi = world_box(o)
    ex = hi - lo
    if lo.z >= shell_top[unit_key] - 0.3 and min(ex.x, ex.y) >= 10 and ex.z < 3:
        return True
    return ex.z < 0.5 and min(ex.x, ex.y) > 1 and max(ex.x, ex.y) > 10 and hi.z >= unit_top[unit_key] - 0.5


def is_enclosure(o, unit_key):
    """
    A big box drawn with a handful of triangles is an enclosure outline -
    a pipe bridge's sheeting, a bridge housing - not steel or equipment,
    which are never that big and that simple at once.
    """
    if unit_key.startswith(('slab', 'drive_in')):
        return False
    lo, hi = world_box(o)
    ex = hi - lo
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    return min(ex) >= 3 and max(ex) >= 5 and tris <= 150


def part_class(o, unit_key, col):
    k = kind(o.name)
    if k in DECK_KINDS:
        return 'grating'
    up = ancestry(o)
    shape = panel(o)
    building = not VESSEL.search(unit_key) and not unit_key.startswith(('slab', 'drive_in'))
    if ('door' in up or is_cover(o, unit_key) or is_enclosure(o, unit_key)
            or (shape == 'wall' and building)):
        return 'cladding'
    # after walls, before roofs: steelwork groups hold the floor plates, which
    # are as thin and wide as any roof
    if 'steel' in up:
        return 'steel'
    if shape == 'flat' and building:
        return 'cladding'
    if k == 'ACPPSTRUCTURERAILING':
        return 'handrail'
    if k in ('ACPPSTRUCTURESTAIR', 'ACPPSTRUCTUREPLATE'):
        return 'grating'
    if k == 'ACPPSTRUCTUREBEAM':
        return 'steel'
    if k in ('ACPPPIPE', 'ACPPPIPEINLINEASSET', 'ACPPCONNECTOR') or unit_key.startswith('all_pipes'):
        return 'pipe'
    if unit_key.startswith('slab') or unit_key == 'drive_in_sump':
        return 'concrete'
    if unit_key.startswith(('stair', 'high_level_bridge', 'pipe_bridge')):
        return 'steel'
    if unit_key == 'person':
        return 'person'
    # CAD default whites carry no information; anything else was chosen
    r, g, b = col
    if min(r, g, b) > 0.85:
        return 'equip'
    return 'paint'


# Every class gets a colour of its own. The page repaints them anyway, but
# identical materials get merged by the optimiser and the class goes with them.
CLASS_COLOUR = {
    'steel': (0.34, 0.38, 0.43),
    'handrail': (0.88, 0.70, 0.12),
    'grating': (0.49, 0.52, 0.55),
    'concrete': (0.55, 0.55, 0.53),
    'cladding': (0.62, 0.65, 0.68),
    'person': (1.00, 0.54, 0.12),
    'ramp': (0.20, 0.90, 0.30),
}


# ---------------------------------------------------------------- 1. prune

scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
stats['objects_in'] = len(meshes)
stats['tris_in'] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)

def is_drawing(o):
    """Flat and huge outside the slabs: swept paths and set-out lines, not steel."""
    d = sorted(o.dimensions)
    return d[0] < 0.3 and d[2] > 20 and 'slab' not in ancestry(o) and kind(o.name) not in DECK_KINDS


drop = []
for o in meshes:
    if kind(o.name) in DROP_KINDS or is_drawing(o):
        drop.append(o); stats['dropped_annotation'] += 1
    elif o.dimensions.length < MIN_SIZE:
        drop.append(o); stats['dropped_small'] += 1
bpy.data.batch_remove(drop)
log(f'pruned {len(drop)} of {len(meshes)} objects')

# ------------------------------------------------------- 2. classify, remap

keys = {}                       # source unit name → generic key
used = collections.Counter()
mats = {}                       # (class, colour) → material
groups = collections.defaultdict(list)

unit_objs = collections.defaultdict(list)
for o in [o for o in scene.objects if o.type == 'MESH']:
    # Blender renames repeats (Thickener, Thickener.001, ...) - one unit, not many
    u = re.sub(r'\.\d{3}$', '', unit_of(o))
    if u not in keys:
        base = slug(u)
        used[base] += 1
        keys[u] = base if used[base] == 1 else f'{base}_{used[base]}'
    unit_objs[keys[u]].append(o)

# a big open vessel's shell: the widest part that is also properly tall
for key, objs in unit_objs.items():
    if VESSEL.search(key):
        tops = [hi.z for lo, hi in map(world_box, objs)
                if min(hi.x - lo.x, hi.y - lo.y) >= 10 and hi.z - lo.z >= 5]
        if tops:
            shell_top[key] = max(tops)
            unit_top[key] = max(hi.z for lo, hi in map(world_box, objs))
log(f'vessel shells: {dict((k, round(v, 1)) for k, v in shell_top.items())}')

def class_material(cls, col=None):
    """The one material for a part class - and for paint, equipment and pipe, its colour."""
    mk = (cls, col if cls in ('equip', 'paint', 'pipe') else None)
    if mk not in mats:
        m = bpy.data.materials.new(
            cls if mk[1] is None else f'{cls}_{"".join(f"{round(c * 255):02x}" for c in col)}')
        m.diffuse_color = (*(mk[1] or CLASS_COLOUR[cls]), 1)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = m.diffuse_color
        mats[mk] = m
    return mats[mk].name


for key, o in ((k, o) for k, objs in unit_objs.items() for o in objs):
    slots = o.material_slots
    col = colour(slots[0].material) if slots else (0.8, 0.8, 0.8)
    # the material is only read back at merge time; the source mesh is never
    # written to, so shared meshes need no copy
    o['pw_mat'] = class_material(part_class(o, key, col), col)
    groups[key].append(o)
log(f'classified into {len(groups)} units, {len(mats)} materials')

# ----------------------------------------------------------- 3. merge units

class Built(dict):
    """Geometry the converter made itself, in world space, standing in for an object at merge time."""
    def __init__(self, co, tri, cls):
        super().__init__(pw_mat=class_material(cls))
        self.co, self.tri = np.asarray(co, float), np.asarray(tri, np.int64)


def triangles(o):
    """World-space vertices and triangle indices of one object, as arrays."""
    if isinstance(o, Built):
        return o.co, o.tri
    me = o.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    m = np.array(o.matrix_world)
    co = co @ m[:3, :3].T + m[:3, 3]
    tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', tri)
    return co, tri.reshape(-1, 3)


# the faces of a six-sided solid whose corners are numbered s + 2w + 4z, in a
# right-handed (s, w, z): bottom, top, then the four sides, each facing out
HEXA = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 4, 6, 2), (1, 3, 7, 5), (0, 1, 5, 4), (2, 6, 7, 3)]


def hexa(corners):
    """Eight corners, numbered as HEXA wants them, as a closed solid: (vertices, triangles)."""
    tri = [t for a, b, c, d in HEXA for t in ((a, b, c), (a, c, d))]
    return np.asarray(corners, float), np.asarray(tri, np.int64)


def frame_box(d, wv, s0, s1, w0, w1, z0, z1):
    """A box square to a plan direction d (and wv, d turned left), in world space."""
    return hexa([d * s + wv * w + np.array([0, 0, z])
                 for z in (z0, z1) for w in (w0, w1) for s in (s0, s1)])


def merged(parts):
    """Several (vertices, triangles) as one."""
    cos, tris, base = [], [], 0
    for co, tri in parts:
        cos.append(co); tris.append(tri + base); base += len(co)
    return np.concatenate(cos), np.concatenate(tris)


# ------------------------------------------------- 3a. grating, as floor
#
# Grating comes out of the export as its bars: strips 25 mm deep standing on
# edge, 40 mm apart. From above that is lines with nothing between them, and
# nobody can stand on a line. So each one becomes the plate its bars make -
# every cell of a 15 cm grid that a bar runs through is deck, which keeps the
# holes where there are no bars. A PolyLine is a plate's outline: all of its
# box is deck.

DECK_CELL = 0.15
# every deck rectangle made, as (min xy, max xy, top): the ramps land on them
DECKS = []


def rectangles(cell):
    """Cover a boolean grid with rectangles (i0, i1, j0, j1): runs along i, stacked while they repeat."""
    out, open_ = [], {}
    for j in range(cell.shape[1] + 1):
        runs = set()
        if j < cell.shape[1]:
            col = np.concatenate([[False], cell[:, j], [False]])
            edges = np.flatnonzero(col[1:] != col[:-1])
            runs = set(zip(edges[::2].tolist(), (edges[1::2] - 1).tolist()))
        for r in [r for r in open_ if r not in runs]:
            out.append((r[0], r[1], open_.pop(r), j - 1))
        for r in runs:
            open_.setdefault(r, j)
    return out


def deck(o):
    """The plate a grating's bars make, as (vertices, triangles), or None if it is not one."""
    co, tri = triangles(o)
    t = co[tri]
    t = t[np.ptp(t[:, :, 2], axis=1) < 0.08]       # a bar is 25 mm deep; a hatch on a wall is not
    if len(t) < 4:
        return None
    mid = t[:, :, 2].mean(1)
    # levels: heights more than 10 cm apart
    order = np.sort(np.unique(np.round(mid, 3)))
    cuts = order[1:][np.diff(order) > 0.1]
    level = np.searchsorted(cuts, mid, side='right')
    parts = []
    for lv in np.unique(level):
        tt = t[level == lv]
        if len(tt) < 4:
            continue
        z1 = tt[:, :, 2].max()
        z0 = min(tt[:, :, 2].min(), z1 - 0.03)
        lo, hi = tt[:, :, :2].reshape(-1, 2).min(0), tt[:, :, :2].reshape(-1, 2).max(0)
        if kind(o.name) == 'PolyLine':
            boxes = [(lo, hi)]
        else:
            n = np.ceil((hi - lo) / DECK_CELL).astype(int) + 1
            cell = np.zeros(n, bool)
            a = np.floor((tt[:, :, :2].min(1) - lo) / DECK_CELL).astype(int)
            b = np.floor((tt[:, :, :2].max(1) - lo) / DECK_CELL).astype(int)
            for (i0, j0), (i1, j1) in zip(a, b):
                cell[i0:i1 + 1, j0:j1 + 1] = True
            boxes = [(np.maximum(lo + np.array([i0, j0]) * DECK_CELL, lo),
                      np.minimum(lo + np.array([i1 + 1, j1 + 1]) * DECK_CELL, hi))
                     for i0, i1, j0, j1 in rectangles(cell)]
        X, Y = np.array([1.0, 0, 0]), np.array([0, 1.0, 0])
        parts += [frame_box(X, Y, bl[0], bh[0], bl[1], bh[1], z0, z1) for bl, bh in boxes]
        DECKS.extend((bl, bh, z1) for bl, bh in boxes)
    return merged(parts) if parts else None


for key, objs in groups.items():
    for i, o in enumerate(objs):
        if kind(o.name) not in DECK_KINDS:
            continue
        plate = deck(o)
        objs[i] = Built(*plate, 'grating') if plate else None
        stats['decks' if plate else 'decks_not'] += 1
    groups[key] = [o for o in objs if o is not None]
log(f'{stats["decks"]} gratings made into floor, {stats["decks_not"]} were not grating')

# ------------------------------------------------- 3b. stairs, for walking
#
# The stairs are drawn tread by tread, but the landings between flights are
# frames with nothing on them, and anyone walking up one falls through. So
# every flight gets an invisible ramp along its nosings and a short deck off
# each end, which the page walks on and never draws.

RAMP_PAD = 1.1           # m of deck off each end of a flight


def flight_aids(o):
    """The ramp and end decks for one flight, as (s, w, z) quads and its axes; None if it is not one."""
    co, tri = triangles(o)
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    n = np.cross(b - a, c - a)
    area2 = np.linalg.norm(n, axis=1)
    up = np.zeros(len(tri), bool)
    ok = area2 > 1e-9
    up[ok] = n[ok, 2] / area2[ok] > 0.95
    z = np.round((a[:, 2] + b[:, 2] + c[:, 2]) / 3 / 0.02) * 0.02
    # A tread is a filled rectangle across the flight, measured along its own
    # axes. The cut ends of the two stringers are level too, and as wide
    # between them - but mostly empty. A landing frame's top flange is full,
    # but three times as wide as the treads.
    levels = []
    for h in np.unique(z[up]):
        sel = up & (z == h)
        w = area2[sel] / 2
        pts = np.concatenate([a[sel], b[sel], c[sel]])
        xy = pts[:, :2] - pts[:, :2].mean(0)
        axes = np.linalg.eigh(xy.T @ xy)[1]
        wide, deep = np.ptp(xy @ axes[:, 1]), np.ptp(xy @ axes[:, 0])
        if not (wide > 0.5 and deep < 0.6 and w.sum() > 0.6 * wide * deep):
            continue
        cen = ((a[sel] + b[sel] + c[sel]) / 3 * w[:, None]).sum(0) / w.sum()
        levels.append((float(h), cen, pts, wide))
    if levels:
        usual = float(np.median([l[3] for l in levels]))
        levels = [l for l in levels if 0.75 * usual < l[3] < 1.33 * usual]

    def chain(levels):
        """The longest run of evenly spaced levels, and which way it climbs."""
        if len(levels) < 2:
            return None, None
        rise = float(np.median(np.diff([l[0] for l in levels])))
        best, start = (0, 0), 0
        for i in range(1, len(levels) + 1):
            if i == len(levels) or not 0.75 * rise <= levels[i][0] - levels[i - 1][0] <= 1.25 * rise:
                if i - start > best[1] - best[0]:
                    best = (start, i)
                start = i
        run = levels[best[0]:best[1]]
        if len(run) < 2:
            return None, None
        d = np.array([run[-1][1][0] - run[0][1][0], run[-1][1][1] - run[0][1][1], 0.0])
        n = np.linalg.norm(d)
        return (run, d / n) if n > 0.1 else (None, None)

    treads, d = chain(levels)
    if treads is None:
        return None
    (h0, c0, first, _), (h1, c1, _, _) = treads[0], treads[-1]
    run = np.linalg.norm([c1[0] - c0[0], c1[1] - c0[1]])
    wv = np.array([-d[1], d[0], 0.0])
    rise = (h1 - h0) / (len(treads) - 1)
    going = run / (len(treads) - 1)
    ss, ws = first @ d, first @ wv
    depth = ss.max() - ss.min()
    w0, w1 = ws.min() + 0.02, ws.max() - 0.02
    # through the nosings, from the floor a riser below the first tread to
    # the landing a riser above the last
    sb, st = c0 @ d - depth / 2 - going, c1 @ d - depth / 2 + going
    zb, zt = h0 - rise, h1 + rise
    return d, wv, sb, zb, st, zt, w0, w1, (len(treads), round(rise, 3), round(going, 3), round(zb, 2), round(zt, 2))


RAMPS = []                      # (d, wv, sb, zb, st, zt, w0, w1) of every flight; laid in 3d


def walk_ramp(*ramp):
    RAMPS.append(ramp)


flights = []
for o in [o for o in scene.objects if o.type == 'MESH' and kind(o.name) == 'ACPPSTRUCTURESTAIR']:
    got = flight_aids(o)
    if not got:
        stats['stairs_skipped'] += 1
        continue
    *ramp, shape = got
    flights.append(shape)
    walk_ramp(*ramp)
    stats['stairs_ramped'] += 1
log(f'ramps on {stats["stairs_ramped"]} flights, {stats["stairs_skipped"]} skipped')
log('  treads, rise, going, foot, head: ' + ' '.join(str(f) for f in sorted(flights, key=lambda f: f[3])))

# ------------------------------------------ 3c. flights drawn only as handrails
#
# Some flights are in the model as their two handrails and nothing else - no
# stringers, no treads. The rails say all the stair would have: its pitch,
# its width between them, the landing at the top (a handrail's height below
# where the top rail ends) and the floor at the bottom (where the posts
# start). So the flight is built back between them, with a ramp to walk on.

RISER = 0.19          # m, what a flight is divided into when its treads are missing


def rail_run(o):
    """A straight handrail that climbs: its plan line, pitch and heights; None for anything else."""
    co, _ = triangles(o)
    c = co[:, :2].mean(0)
    xy = co[:, :2] - c
    u = np.linalg.eigh(xy.T @ xy)[1][:, 1]
    s = xy @ u
    if np.ptp(s) < 1.0 or np.ptp(xy @ np.array([-u[1], u[0]])) > 0.2:
        return None
    # the top rail: the highest point every quarter metre along it
    bins = np.floor((s - s.min()) / 0.25).astype(int)
    top = np.full(bins.max() + 1, -np.inf)
    np.maximum.at(top, bins, co[:, 2])
    ok = np.isfinite(top)
    pitch = np.polyfit((np.arange(len(top)) * 0.25 + s.min())[ok], top[ok], 1)[0]
    if not 0.5 <= abs(pitch) <= 1.1:            # 27 to 48 degrees: a stair, not a ramp or a ladder
        return None
    u3 = np.array([u[0], u[1], 0.0]) * np.sign(pitch)       # uphill
    ss = co @ u3
    return dict(u=u3, lo=ss.min(), hi=ss.max(), mid=co.mean(0),
                top=co[:, 2].max(), foot=co[:, 2].min(), pitch=abs(pitch))


railings = [(key, o) for key, objs in groups.items() for o in objs
            if not isinstance(o, Built) and kind(o.name) == 'ACPPSTRUCTURERAILING']
rails = [(key, r) for key, o in railings if (r := rail_run(o))]
# how high a handrail stands, from the level ones
level_h = [hi.z - lo.z for lo, hi in (world_box(o) for _, o in railings) if hi.z - lo.z < 1.5]
RAIL_H = float(np.median(level_h)) if level_h else 1.1
stair_boxes = [world_box(o) for o in scene.objects if o.type == 'MESH' and kind(o.name) == 'ACPPSTRUCTURESTAIR']
paired = set()
for i, (key, a) in enumerate(rails):
    for j, (_, b) in enumerate(rails):
        if j <= i or i in paired or j in paired or a['u'] @ b['u'] < 0.99:
            continue
        d = a['u']
        wv = np.array([-d[1], d[0], 0.0])
        gap = abs((b['mid'] - a['mid']) @ wv)
        over = min(a['hi'], b['hi']) - max(a['lo'], b['lo'])
        if not (0.5 < gap < 1.6 and over > 0.7 * min(a['hi'] - a['lo'], b['hi'] - b['lo'])
                and abs(a['top'] - b['top']) < 0.15 and abs(a['foot'] - b['foot']) < 0.15):
            continue
        zt = (a['top'] + b['top']) / 2 - RAIL_H
        zb = (a['foot'] + b['foot']) / 2 - 0.03
        st = min(a['hi'], b['hi'])
        wc = ((a['mid'] + b['mid']) / 2) @ wv
        # rails on a flight the model does have
        mid = d * (st - (zt - zb) / a['pitch'] / 2) + wv * wc + np.array([0, 0, (zt + zb) / 2])
        if any(all(lo[k] - 0.3 <= mid[k] <= hi[k] + 0.3 for k in range(3)) for lo, hi in stair_boxes):
            continue
        paired |= {i, j}
        n = max(2, round((zt - zb) / RISER))
        rise = (zt - zb) / n
        going = rise / a['pitch']
        sf = st - (n - 1) * going                  # the first riser
        w0, w1 = wc - gap / 2, wc + gap / 2
        treads = [frame_box(d, wv, sf + (k - 1) * going, sf + k * going + 0.01, w0 + 0.04, w1 - 0.04,
                            zb + k * rise - 0.04, zb + k * rise) for k in range(1, n)]
        # the stringers follow the nosings, from the floor to the landing
        nose = lambda s: zb + rise + (s - sf) * rise / going
        stringers = [hexa([d * s + wv * w + np.array([0, 0, nose(s) + dz])
                           for dz in (-0.25, 0.05) for w in side for s in (sf - going, st)])
                     for side in ((w0, w0 + 0.03), (w1 - 0.03, w1))]
        groups[key] += [Built(*merged(treads), 'grating'), Built(*merged(stringers), 'steel')]
        walk_ramp(d, wv, sf - going, zb, st, zt, w0 + 0.03, w1 - 0.03)
        stats['flights_built'] += 1
        log(f'  built {key}: {n} risers of {rise:.3f} m, {zb:.2f} -> {zt:.2f} m, {gap:.2f} m wide')
log(f'{stats["flights_built"]} flights built from their handrails')

# ------------------------------------------------------ 3d. lay the ramps
#
# Each ramp runs from the floor a riser below its first tread to the landing
# a riser above its last, with a deck off either end, as thin solids - so
# from underneath, a walker's head meets a ceiling, not a floor to climb on
# to. But the floor a flight arrives on - its grating, or the deck at the
# foot of the next flight - usually starts a hand's width short of where the
# nosings say, and a little higher. Its edge is then a face at knee height in
# the ramp's way, and you have to jump. So each ramp ends at the edge of what
# it arrives on, a hair above it.

aids = []                       # (vertices, triangles) of everything in walk_aids
X2, Y2 = np.array([1.0, 0]), np.array([0, 1.0])
# every floor a flight can arrive on, as oriented rectangles: axis, across, s0, s1, w0, w1, top
floor_rects = [(X2, Y2, lo[0], hi[0], lo[1], hi[1], top) for lo, hi, top in DECKS]
floor_rects += [(d[:2], wv[:2], sb - RAMP_PAD, sb, w0, w1, zb) for d, wv, sb, zb, st, zt, w0, w1 in RAMPS]
FA = np.array([r[0] for r in floor_rects]); FW = np.array([r[1] for r in floor_rects])
FR = np.array([r[2:] for r in floor_rects])


def landing(d, wv, s0, s1, w, near, own):
    """Going up the line w from s0 to s1, where the first floor about as high as near starts, and its top."""
    level = (FR[:, 4] > near - 0.1) & (FR[:, 4] < near + 0.15)
    level[own] = False
    for s in np.arange(s0, s1, 0.02):
        p = (d * s + wv * w)[:2]
        a, c = FA @ p, FW @ p
        on = level & (FR[:, 0] <= a) & (a <= FR[:, 1]) & (FR[:, 2] <= c) & (c <= FR[:, 3])
        if on.any():
            return s, float(FR[on, 4].max())
    return None


for k, (d, wv, sb, zb, st, zt, w0, w1) in enumerate(RAMPS):
    got = landing(d, wv, st - 0.6, st + 0.3, (w0 + w1) / 2, zt, len(DECKS) + k)
    if got:
        st, zt = min(st, got[0]), got[1] + 0.005
        # no steeper than 45 degrees: on a two-tread flight, pulling the top
        # back that far would make a slope nobody can walk up
        sb = min(sb, st - (zt - zb))
        stats['ramps_met'] += 1
    for s0, z0, s1, z1 in ((sb, zb, st, zt), (st, zt, st + RAMP_PAD, zt), (sb - RAMP_PAD, zb, sb, zb)):
        top = [d * s + wv * w + np.array([0, 0, z]) for w in (w0, w1) for s, z in ((s0, z0), (s1, z1))]
        aids.append(hexa([p - np.array([0, 0, 0.04]) for p in top] + top))
log(f'{len(RAMPS)} ramps laid, {stats["ramps_met"]} ending at the floor they arrive on')

out_objs = []
for gi, (key, objs) in enumerate(groups.items()):
    slot_of, mat_list = {}, []
    cos, tris, mids = [], [], []
    base = 0
    for o in objs:
        m = bpy.data.materials[o['pw_mat']]
        if m.name not in slot_of:
            slot_of[m.name] = len(mat_list); mat_list.append(m)
        co, tri = triangles(o)
        cos.append(co); tris.append(tri + base); base += len(co)
        mids.append(np.full(len(tri), slot_of[m.name], dtype=np.int32))
    co = np.concatenate(cos); tri = np.concatenate(tris); mid = np.concatenate(mids)

    me = bpy.data.meshes.new(key)
    me.vertices.add(len(co))
    me.vertices.foreach_set('co', co.astype(np.float32).ravel())
    me.loops.add(len(tri) * 3)
    me.loops.foreach_set('vertex_index', tri.astype(np.int32).ravel())
    me.polygons.add(len(tri))
    me.polygons.foreach_set('loop_start', np.arange(0, len(tri) * 3, 3, dtype=np.int32))
    me.polygons.foreach_set('material_index', mid)
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bm.to_mesh(me)
    bm.free()
    for m in mat_list:
        me.materials.append(m)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=SMOOTH_ANGLE)
    out_objs.append(bpy.data.objects.new(key, me))
    if (gi + 1) % 20 == 0 or gi + 1 == len(groups):
        log(f'merged {gi + 1}/{len(groups)} units')

if aids:
    me = bpy.data.meshes.new('walk_aids')
    co, tri = merged(aids)
    me.from_pydata(co.tolist(), [], tri.tolist())
    me.materials.append(bpy.data.materials[class_material('ramp')])
    out_objs.append(bpy.data.objects.new('walk_aids', me))

# clear the source hierarchy: every original object and empty goes, in one call
bpy.data.batch_remove([o for o in bpy.data.objects if o not in out_objs])
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
for ob in out_objs:
    scene.collection.objects.link(ob)
log('source hierarchy cleared')

# -------------------------------------------------------------- 4. recentre

def coords(me):
    a = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


allv = np.concatenate([coords(ob.data) for ob in out_objs])
lo, hi = allv.min(0), allv.max(0)
shift = mathutils.Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, 0))
for ob in out_objs:
    ob.data.transform(mathutils.Matrix.Translation(shift))
    # origin at the middle of the unit's bounding box, so the page can find it
    v = coords(ob.data)
    c = mathutils.Vector(((v.min(0) + v.max(0)) / 2).tolist())
    ob.data.transform(mathutils.Matrix.Translation(-c))
    ob.location = c

# purge everything the source brought with it
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    bpy.data.batch_remove([d for d in block if d.users == 0])
log('purged source data')
scene.name = 'plant'
bpy.data.worlds.remove(bpy.data.worlds[0]) if bpy.data.worlds else None

stats['objects_out'] = len(out_objs)
stats['tris_out'] = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in out_objs)
stats['materials_out'] = len(mats)

# ---------------------------------------------------------------- 5. export

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=False,
    export_extras=False, export_cameras=False, export_lights=False,
    export_apply=True, export_yup=True, export_normals=True,
    export_texcoords=False, export_materials='EXPORT',
)
stats['seconds'] = round(time.time() - t0, 1)
log('exported')

per_unit = sorted(
    ((ob.name, sum(len(p.vertices) - 2 for p in ob.data.polygons)) for ob in out_objs),
    key=lambda x: -x[1])
print('STATS', dict(stats))
print('TOP', per_unit[:15])
print('MATS', sorted(m.name for m in mats.values()))
if REPORT:
    # the source → key map stays next to the local build; it is never shipped
    json.dump({'stats': stats, 'keys': keys, 'units': per_unit}, open(REPORT, 'w'), indent=1)
