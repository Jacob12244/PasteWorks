# PasteWorks

An interactive cemented paste backfill plant, built in Three.js.

You run a real CPB flowsheet — thickener, underflow surge, plate press, cake
bin, binder silo, twin-shaft mixer, positive-displacement paste pump — and push
paste 1,200 m down a borehole into a stope, without plugging the line.

It looks like a factory game. Underneath, every number is the engineering.

There is a control room on the pad. Sit down at it and you get four SCADA
screens — mimic, setpoints, annunciator, trends — with the plant still running
out of the window behind them.

---

## The flowsheet

```
  mill tails ──► THICKENER ──► U/F SURGE ──► PLATE PRESS ──► CAKE BIN
   180 t/h        18 m Ø        260 m³        120 m² cloth       │
   @ 32% Cw          │              │              │             │
                     │              └── filtrate ──┤             │
                     └── overflow ────────────────►│             │
                                                   ▼             ▼
                                          PROCESS WATER ───► MIXER ◄─── BINDER SILO
                                             (recycle)          │          420 t
                                                                ▼
                                                          PASTE PUMP  190 m³/h, 120 bar
                                                                │
                                                     1,200 m developed
                                                       250 m vertical drop
                                                                ▼
                                                      STOPE 14-2 NORTH  6,000 m³
```

Hard mode puts the circuit that *makes* the tailings in front of it — ball
mill, flotation bank, deslime cyclones — and a ball hopper you have to keep
filled.

## The physics

Every model here is the standard one. The constants are plausible rather than
site-calibrated — a real job fits each of them to loop-test data on the actual
tailings — but the *form* of each equation is real, so the trade-offs the game
makes you feel are the trade-offs the plant actually has.

| Quantity | Model | Where |
| --- | --- | --- |
| Solids, density, volumetric flow | Three-component mass balance (dry tails / water / binder); nothing is stored that can be derived | [streams.ts](src/sim/streams.ts) |
| Yield stress | `τy = A·exp(B·Cv)`, stiffened by binder dose | [rheology.ts](src/sim/rheology.ts#L31) |
| Slump | Boger — Pashias et al. (1996) — on the 200 mm cylinder, which is what a paste plant actually measures; the Abrams cone is carried alongside as a reported number | [rheology.ts](src/sim/rheology.ts#L50) |
| Pipeline friction | Buckingham equation for laminar Bingham-plastic flow, solved for wall shear by bisection | [rheology.ts](src/sim/rheology.ts#L96) |
| Turbulent transition | Bingham Reynolds number with a Hedström-dependent critical value | [rheology.ts](src/sim/rheology.ts#L140) |
| Static head recovery | `ρgΔz` — the only reason a 1,200 m paste line is possible at all | [rheology.ts](src/sim/rheology.ts#L163) |
| 28-day UCS | `UCS = k·Bd^1.4·exp(c·(Cw − Cw₀))`, after Belem & Benzaazoua | [rheology.ts](src/sim/rheology.ts#L180) |
| Thickener | Settling flux vs rise rate, flocculant-dependent underflow ceiling, rake torque | [plant.ts](src/sim/plant.ts) |
| Plate press | Capacity ∝ `1/√(cycle time)`, cake moisture falling with it | [plant.ts](src/sim/plant.ts) |
| Pipe wear | `∝ V^2.4 · (0.35 + Cv)`, eating the bore over the shift | [rheology.ts](src/sim/rheology.ts) |
| Grind (hard mode) | Bond's law: `W = 10·Wi·(1/√P80 − 1/√F80)` | [upstream.ts](src/sim/upstream.ts) |
| PSD (hard mode) | Gates-Gaudin-Schuhmann: `F(x) = (x/k)^m` | [upstream.ts](src/sim/upstream.ts) |
| Cyclone (hard mode) | `d50c ∝ 1/√P`, with a 28% fines bypass to underflow | [upstream.ts](src/sim/upstream.ts) |
| Flotation (hard mode) | Mass pull from head grade, recovery and concentrate grade | [upstream.ts](src/sim/upstream.ts) |
| Liberation (hard mode) | Recovery falls away past a 140 µm P80 (locked composites) and below 60 µm (slimes) | [upstream.ts](src/sim/upstream.ts) |
| Mill power (hard mode) | Bond charge-filling law, P ∝ J·(1 − 0.937J), so an under-charged mill grinds coarser | [upstream.ts](src/sim/upstream.ts) |

A worked check of where those land:

```
  Cw     Cv    tau_y Pa   eta Pas   Boger mm   cone mm   UCS kPa    (5% binder)
 0.740  0.503       126     0.277        150       245       852
 0.760  0.530       200     0.352        132       224       999
 0.780  0.558       326     0.454        107       194      1173
 0.800  0.587       543     0.591         76       154      1376
```

Slump is quoted on the **Boger cylinder** — a 200 mm mould, the Pashias/Boger
relation, and the number a paste plant actually controls on. It is repeatable
on a stiff paste where an Abrams cone is not, and it inverts straight back to a
yield stress: a $2 mould that reads out a rheology. The cone equivalent is
reported next to it because every site conversation ends up in inches of cone.

## The game

**Fill Stope 14-2 North — 6,000 m³ — at 1,000 kPa UCS, as cheaply as you can,
without plugging the line.**

Six setpoints, and every one of them fights at least one other:

- **Flocculant dose** buys settling flux *and* the underflow density ceiling.
  It costs $4,200/t.
- **U/F density target** is capped by the flocculant. Push past it and rake
  torque climbs toward a trip.
- **Press cycle time** trades throughput against cake moisture. Capacity falls
  as `1/√t` while the cake gets drier — and cake moisture sets a hard ceiling
  on paste density, because you can add water at the mixer but never take it out.
- **Binder dose** is the dominant cost and the only real lever on strength.
- **Slump target** is the sharp one. Wetter paste pumps easily and costs less
  but loses strength; drier paste is stronger but the friction gradient climbs
  fast. The whole usable window is about 60 mm wide, and the last 10 mm of it
  is a cliff.
- **Pump stroke rate** sets placement rate — out-run the press and the cake bin
  empties.

What that produces, from `npm run verify:scenarios`:

```
                       discharge      velocity    UCS   12 h fill    $/m³   spill
baseline    (125 mm)   53 bar ( 44%)  1.85 m/s   1051     23.6%    11.61      0
stiff paste  (95 mm)  119 bar ( 99%)  1.85 m/s   1255     23.6%    12.48      0   at the rating, still keeping up
press limited(90 mm)  120 bar (100%)  1.07 m/s   1287     13.6%   193.20    979   pegged — and the pad floods
very stiff   (86 mm)   99 bar ( 82%)  0.00 m/s   1312      0.0%        —      0   PLUGGED
wet paste   (160 mm)    0 bar (  0%)  1.85 m/s    760     23.6%    18.84     80   free-flowing, off spec
lean binder  (2.5%)    54 bar ( 45%)  1.85 m/s    409     23.6%     6.45      0   cheap, off spec
rich binder  (7.5%)    52 bar ( 44%)  1.85 m/s   1810     23.6%    16.54      0   over-engineered
```

Read those middle three rows. Ninety-five millimetres of slump is fine — the
pump is at 99% of its rating and the plant is still placing 23.6% of the stope
in twelve hours. Take five millimetres more out of it and the pump pegs, the
line velocity drops to 1.07 m/s, placement falls by 42% — and because the plant
is no longer keeping up with the mill, **979 m³ of process water ends up on the
pad**. Five millimetres further and the column sets up in the hole.

One rheology decision, three hours later, is an environmental incident. That
cascade is not scripted; it falls out of the mass balance.

The pump is modelled the way a positive-displacement pump really behaves: it
delivers whatever the line asks for right up to its 120 bar rating, and then it
simply stops pushing. Ask for paste that is too stiff and throughput collapses
first and the column sets up second.

`npm run verify:solve` grid-searches the space: it is winnable, and the
cheapest on-spec answer is around **4.6% binder at 112 mm slump — $11.15/m³,
1,021 kPa, 48 hours**. Of 120 configurations near the sweet spot, 96 make the
grade and 24 come up short on strength.

### The water balance will catch you

Everything the thickener and the press take out of the tailings has to go
somewhere. The mixer drinks about 20 m³/h of it; the rest goes back to the
mill, and the mill will only take 330 m³/h. Go over that and the process water
tank fills, overflows onto the pad, and costs you $150/m³ in clean-up.

It is not a side quest — it is coupled to everything else:

- Chase a **drier cake** for strength and you recover *more* water, not less.
- Let the **pump fall behind the mill** and solids pile up in the thickener
  while their water keeps reporting to the launder. A rheology mistake becomes
  a water incident about two hours later.
- Run **wetter paste** and the mixer consumes more of the surplus.

Tanks show this rather than telling you. The surge tank and the process water
tank are both cut away behind sight glasses so the level is something you
watch, and when one goes over you get streams off the rim, splash at the pad,
a spreading puddle that stays there afterwards, and a red beacon.

## Hard mode

Standard mode hands you a fixed tailings stream. Hard mode hands you the
circuit that makes it:

```
  ore ──► BALL MILL ──► FLOTATION BANK ──► DESLIME CYCLONES ──► backfill plant
          4,600 kW        5 cells             8 × radial             │
             │               │                     │                 │
          P80 sets      concentrate            fines to TSF      the paste
          the PSD       takes the S
```

Five more controls, and each one reaches all the way to the stope:

- **Mill feed** — fixed power over more tonnes is a coarser grind. 250 t/h
  gives a 52 µm P80; 620 t/h gives 265 µm. Coarse tailings filter faster, pump
  easier and need less binder — but this is not a free ride in one direction,
  because of liberation (below).
- **Frother dose** — buys sulphide recovery. What you fail to float stays in
  the tailings, and sulphate attack eats ordinary portland: at 1.57% S the
  28-day strength multiplier is **0.68**.
- **Binder type** — a slag blend largely resists that (**1.15** at the same
  sulphur) but costs $175/t against $148/t.
- **Deslime cyclones** — reject the fines and everything downstream improves.
  It is the single biggest lever in the game, and it throws away a quarter of
  the tonnage you were going to fill the stope with.
- **Grinding media** — the mill eats 0.33 t/h of steel balls, fed from a
  16 t day bin. See below.

### Liberation: why coarse is not simply better

Reagent cannot recover what the mill has not liberated. Past about 140 µm the
sulphides are still locked inside composite particles and walk straight out
with the tailings; grind too fine instead and slimes cost you recovery at the
other end. So mill feed has a real optimum rather than a direction:

```
  mill t/h   P80 um   <20 µm   liberation   tails %S   UCS x (OPC)
       250       52    20.8%          93%       0.68          0.81
       320       82    11.7%         100%       0.46          0.99
       420      134     7.0%         100%       0.46          1.11
       520      196     4.9%          84%       0.98          0.95
       620      265     3.7%          64%       1.61          0.70
```

Coarse costs you liberation; fine costs you filtration and binder. The window
is narrow and it sits right about where the default sits.

### Grinding media: the consumable you will forget

The mill draws power in proportion to its charge filling, `J·(1 − 0.937J)`, so
an under-charged mill physically cannot put the energy in. On top of that, a
charge that is never topped up loses its top size — the coarse-breaking end of
the distribution wears away and the mill behaves like harder ore. Both push the
product coarser, and coarse means unliberated:

```
  charge condition   mill kW   Wi eff   P80 um   liberation   tails %S   UCS x
              100%      4600     14.2      134         100%       0.46   1.111
               60%      4155     17.3      228          75%       1.27   0.834
               20%      3618     20.4      381          32%       2.60   0.298
                0%      3316     22.0      494          30%       2.65   0.277
```

The ball hopper holds 16 t, about two days of charging, and it is the one
consumable with no immediate symptom — nothing trips, the plant just quietly
starts making worse paste. `verify:hard` runs the experiment:

```
default hard mode             UCS 1377 avg / 1377 weakest   ON SPEC
never order grinding media    UCS 1256 avg /  641 weakest   "on spec"
no media + lean binder 3.8%   UCS  865 avg /  441 weakest   under
```

The middle row is the point. Averaged over the stope it passes, and the average
is what gets signed off — but the last few lifts went in at 641 kPa against a
1,000 kPa design, and the weakest lift is what actually fails.

The particle size then drives four multipliers on the backfill plant:

| tailings | press capacity | cake moisture | yield stress | 28 d UCS |
| --- | --- | --- | --- | --- |
| 19% < 20 µm (no deslime) | ×1.08 | ×0.96 | ×0.93 | ×0.89 |
| 7% < 20 µm (deslimed) | ×1.88 | ×0.74 | ×0.55 | ×1.11 |

Full runs, from `npm run verify:hard`:

```
default hard mode                UCS 1377   $20.62/m³   ON SPEC
coarse grind 560 t/h             UCS 1067   $21.61/m³   ON SPEC
fine grind 260 t/h               UCS  895   $20.82/m³   under, and 12 h slower
deslime + coarse + lean binder   UCS  761   $18.34/m³   under
starved flotation (no frother)   UCS  856   $20.15/m³   under
no frother + slag binder         UCS 1440   $22.20/m³   ON SPEC
```

That last pair is the decision hard mode exists for: your flotation is running
badly, so either fix the flotation or pay for a binder that does not care.

Press **H** to switch, or use the Standard / Hard mode buttons on the console.
Hard mode costs more per cubic metre because the grinding power and the
grinding media are now inside your cost boundary — it is a different accounting
fence, not a worse plant.

## The control room

Click the hut on the pad — or press **C** — and you sit down at the desk.
The camera goes *inside* the building, at eye height in the chair, looking out
through the real glass at the plant. **Drag to look around**: the camera turns
and never moves, the way your head does when you are sitting down.

```
  ┌──────────── glass ────────────┐   the plant, still running, out the window
  │  01 MIMIC      │  02 SETPOINTS │
  │  03 ANNUNCIATOR│  04 TRENDS    │
  └──────────── desk ─────────────┘   start/stop, speed, deliveries, pilot lamps
```

Every screen has a **minimise** and a **maximise** button. Maximise one and it
fills the wall — the mimic in particular is worth blowing up. Minimise drops it
to a pill on the desk edge; clear all four and you are simply sitting at a
window watching the plant run.

- **01 Mimic** — the whole flowsheet as tiles, every one carrying its live
  numbers, outlined amber or red when a condition stands against it.
- **02 Setpoints** — the same nine loops as the side console, tagged the way
  they would be on a real mimic (WIC-101, DIC-320, QIC-610…). They *are* the
  same setpoints: both screens build from one spec list and write straight into
  the plant, so moving one moves the other.
- **03 Annunciator** — a 24-lamp box. Standing conditions flash amber or red at
  different rates the way a real annunciator does, with the event log beneath.
- **04 Trends** — UCS, discharge pressure, placement rate and process water
  level over the last six shift-hours, with the design limits dashed across.

### Why the screens move when you turn your head

The video wall is HTML, not geometry — that is what keeps the text crisp and
the sliders real controls rather than raycast targets. But a fixed overlay
while the world turns behind it would read as screens strapped to your face.

The fix falls out of the constraint: **the operator never leaves the chair**,
so the camera only ever rotates. Under pure rotation every direction in the
world shifts by the same angle regardless of distance — there is no parallax to
reproduce. So matching the camera exactly is a translation of
`tan(angle) / tan(half FOV)` of the frame, with no perspective skew and no
resampling. The wall is bolted to the room; the desk is not, because sliding
the stop button off the screen would be a poor trade for a little more realism.

Look is clamped to about ±30° of yaw and a similar band of pitch, which is
roughly the width of the window. `↻ Centre` squares you back up; `Esc` or
**Leave the desk** puts you back outside.

## Running it

```bash
npm install
npm run dev        # http://localhost:5180
```

```bash
npm run build      # static bundle in dist/
npm run typecheck
npm run verify     # the four physics harnesses, outside the browser
```

**Controls** — drag to orbit, scroll to zoom, click any unit to inspect it.
`Space` run/stop, `1`–`5` time compression (pause → 240×), `O`/`P`/`U` for the
overview, plant and stope views, `G` for the grinding circuit, `C` for the
control room, `H` to toggle hard mode, `Esc` to deselect or to leave the desk.

In the control room, drag to look around — you turn but never move.

## Putting it on the server

PasteWorks is a static bundle that runs entirely in the browser — no API, no
database, **no sign-in**. So it is the simplest stack on the box: one nginx
container on `127.0.0.1:8460`, with the host nginx proxying
`https://pasteworks.minesmart.cloud` to it and certbot terminating TLS. Same
shape as the other apps there (assetpro 8410, pidpro 8420, pipelinepro 8430,
portal 8440, processpro 8450), minus everything those need and this does not.

Nothing is provisioned in the `Identity` repo. No Keycloak client, no audience
scope, no group. Anyone with the link opens it, which is the point.

```
  infra/deploy/
    docker-compose.yml                       one service, one port
    web/Dockerfile                           node build -> nginx runtime
    web/nginx.conf                           gzip, immutable assets, /healthz
    nginx/pasteworks.minesmart.cloud.conf    the host vhost
    build-push.ps1                           build on a workstation, push to ghcr
    redeploy.sh                              pull and restart on the server
    README.md                                the walkthrough
```

Full instructions are in [infra/deploy/README.md](infra/deploy/README.md). The
short version, once the repo exists on GitHub and DNS points at the box:

```powershell
cd infra\deploy; .\build-push.ps1          # on a workstation
```

```bash
cd /home/ben && git clone <repo> pasteworks   # first time only
cd pasteworks/infra/deploy && docker compose pull && docker compose up -d
sudo cp nginx/pasteworks.minesmart.cloud.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/pasteworks.minesmart.cloud.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pasteworks.minesmart.cloud
```

After that, `./redeploy.sh` is the whole update cycle. There is no `.env` to
fill in and nothing to back up.

## How it is built

No asset pipeline. Every vessel, walkway, handrail, ladder and pipe spool is
generated from primitives at load time, so the whole plant is code:

```
src/
  sim/
    streams.ts     three-component stream algebra
    upstream.ts    mill, flotation and cyclones - hard mode only
    rheology.ts    yield stress, slump, Bingham pipeline, UCS
    plant.ts       unit operations, inventories, alarms, the tick loop
  view/
    palette.ts     one palette: cold structure, warm process
    parts.ts       platforms, railings, ladders, level bars, holographic tags
    flow.ts        travelling-band pipe shader, driven from real velocity
    particles.ts   pooled point-sprite system for every failure mode
    spill.ts       a vessel overflowing: streams, splash, puddle
    units.ts       thickener, surge tank, press, cake bin, silo, mixer, pump
    upstream.ts    ball mill, flotation bank, deslime cyclone cluster
    terrain.ts     ground, rock block model, borehole, stope
    world.ts       site layout and interconnecting pipework
    scene.ts       renderer, IBL, lighting, bloom
  ui/
    setpoints.ts   the nine loops, described once, shared by both consoles
    hud.ts         side console, alarm log, per-unit inspector
    scada.ts       the control room: mimic, annunciator, trends, video wall
```

A few things worth knowing if you pick it up:

- **Metals need image-based lighting.** `MeshStandardMaterial` with high
  metalness and no environment map renders black. A PMREM of the stock
  `RoomEnvironment` is most of the difference between "3D shapes" and "a plant".
- **Flow bands are spaced in UV**, and a tube's UV runs 0..1 whatever its real
  length, so band count is derived from length (`bandsFor`) or a 5 m spool looks
  like a caterpillar track.
- **The ground plane has a hole punched in it** over the section, otherwise it
  quietly roofs over the stope.
- **Alarms latch.** They log once when a condition comes in and once when it
  clears, the way an annunciator does — not on every scan. The control room
  annunciator then reads the standing set directly, so the lamps and the log
  can never disagree.
- **Overlay panels must not fight over grid rows.** The inspector and the side
  console started life in rows 3 and 2 of the same CSS grid, so opening the
  inspector silently stole the console's height. Spanning the console across
  both rows fixes it: rows 2 + 3 always sum to the same thing.

## Credits

Built for a "how could mining and materials transport look in the future"
brief, inspired by the engineering Paterson & Cooke do every day: slurry and
paste pipeline transport, thickening and filtration, and backfill systems.

---

## What to look at first

1. Press **Start plant**, leave it at 60×, and watch the plate press shifter
   walk the pack open and drop cake while the stope starts filling.
2. Click the **paste line**, then drag the slump target down from 125 mm to
   95 mm. Nothing much happens — the pump is at 99% and coping. Take five more
   millimetres out of it and the discharge pegs, the velocity collapses, and
   about three hours later the process water tank starts pouring onto the pad.
   Five further millimetres and the column sets up in the hole.
3. Click the **process water tank** and keep half an eye on the level. It is
   the slowest thing in the plant and the first thing to catch you out.
4. Press **H** for hard mode, then **G**. The mill drum turns, the flotation
   bank works a froth into its launders, and the cyclone cluster lights up when
   it is in circuit. Bypass the deslime and watch every number downstream get
   worse at once.
5. Still in hard mode, press **C** and sit in the control room. Run it at 240×
   from there and do *not* order grinding media. The ball hopper empties around
   hour 33, nothing trips, and you can watch the UCS trace bend downwards on
   screen 04 while the mimic's P80 climbs.
