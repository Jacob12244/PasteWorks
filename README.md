# PasteWorks

An interactive cemented paste backfill plant, built in Three.js.

You run a real CPB flowsheet — thickener, underflow surge, plate press, cake
bin, binder silo, twin-shaft mixer, positive-displacement paste pump — and push
paste 1,200 m down a borehole into a stope, without plugging the line. Then you
run it again in 2068 on the abyssal plain, in 2091 on an asteroid, in 2137 under
a city and in 2805 after everyone has left, and it is a different plant every
time, because the world it is in asks for one.

It looks like a factory game. Underneath, every number is the engineering.

It opens on a choice of five worlds. Pick one and it plays a short opening
explaining how things got this way, then sits you in the control room: four
SCADA screens, a warnings banner above them, sixteen trends, and the plant
still running out of the window behind the glass.

And after the shift, [`/?arena`](#paste-wars) turns the pad into **Paste Wars**:
splat tag on the running plant for up to fifteen people, with paste guns,
rocks, and filter cake off the floor to reload.

---

## Five worlds

In date order, which is the order on the title screen:

| Era | World | Where | Front end | Dewatering | Destination | Target | Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Today | Stope 14-2 North | underground gold mine | ball mill → flotation → deslime cyclones | thickener → surge → press | stope, 1,200 m line, 250 m drop | 1,000 kPa | $21/m³ |
| 2068 | Station Nereid | Clarion–Clipperton Zone, 4,400 m down | seabed collector → nodule screen → deslime cyclones | cyclone bank → surge → press | Furrow 7, 2,800 m along the floor, no drop | 600 kPa | $23/m³ |
| 2091 | Mass Driver One | 16 Psyche | open pit → ball mill → magnetic drums | decanter centrifuges → surge → press | slugs fired off a mass driver | 750 kPa | $300/m³ |
| 2137 | Meridian Undercity | the canyon under Tower 9 | dredge on the old tailings dam → deslime cyclones | thickener → surge → press | Void V-9, 1,500 m line, 620 m drop | 1,500 kPa | $31/m³ |
| 2805 | Last Shift | Earth, long after | loaders on waste piles → crusher → scrap magnet | none — the feed is dry | Crater 4, an old war crater | 1,200 kPa | $32/m³ |

Every world is the same simulation with different equipment, prices and
physics. That keeps them honest: nothing in a future world is a special rule,
it is the same mass balance meeting a different set of constraints.

- **Station Nereid (2068).** Nodule mining the second time round, after the
  first generation left a sediment plume four hundred kilometres long. There
  is no thickener, because there is nothing to settle into at 4,400 m that is not
  the sea, so a **cyclone bank** dewaters inline. Tighter spigots give a denser
  underflow and throw more fines out of the top, and out of the top is the
  ocean: every tonne of fines that leaves the plant is a $250 plume penalty.
  The line runs 2.8 km flat along the seabed, so static head gives nothing
  back. At 2 °C cement cures at about two-thirds of its surface rate, so the
  same strength needs a stiffer, richer paste. Water is free — the sea is the
  process water tank. The control room is a hut in a pressure sphere, with the
  fish going past the glass.
- **Mass Driver One (2091).** Surface gravity is 0.144 m/s². A thickener would
  take a geological age, so **decanter centrifuges** (650 kW of them) do the
  settling by spinning, and the tailings are bound into slugs and fired off the
  asteroid at 300 m/s to a station that wants the mass for shielding — there
  is no stope in a vacuum to put them back into. Gravity is the only thing the
  pipeline model changes: static head is `ρgΔz`, and there is almost no `g`. Water is
  shipped in at $400/m³, every cubic metre locked into a slug is lost for good,
  and binder is $1,650/t for the same reason. The metal comes out on **magnetic
  drums**; grind coarser than about 140 µm and it stays locked in the silicate.
- **Meridian Undercity (2137).** The mine closed in 2040, and ninety years on the old
  stopes are migrating up under the towers. The feed is that mine's own
  **tailings dam**, dredged: the grind is whatever it was in 2040, and after a
  hundred years of rain it is pyritic — at 1.3% S, ordinary portland loses the
  strength to sulphate attack and the slag blend is not optional. 620 m of drop,
  a 1,500 kPa target because a tower stands on it, and power at $0.46/kWh.
- **Last Shift (2805).** No mine and no stope. The feed is two centuries of
  waste piles, scooped by loaders and crushed, with a scrap magnet pulling the
  steel. It arrives **dry**, so there is no thickener, no surge tank and no
  press — and every litre of mix water is hauled in at $90/m³. The crusher
  hammers wear like grinding media and have to be ordered. The paste goes into
  the craters the war left.

Consumables arrive the way each era would send them — a tanker today, a pod
lowered on a cable from the ship in 2068, a lander in 2091, a drone with a slung
container in 2137, and in 2805 a crate on a teleport pad. They are driven by
the same delivery events as the alarm log, so they turn up when the order lands.

Each opening is letterboxed, typed out a line at a time and cut through black,
with the camera flying the actual world. **Skip** jumps to the objective card;
untick *Play the opening* on the title screen to go straight in. `?s=abyss`
(or `today`, `psyche`, `undercity`, `caretaker`) skips the title screen, and
`&intro=0` skips the opening too.

`npm run verify:worlds` proves every one of them winnable, first at its
default setpoints and then at a reference recipe:

```
scenario     defaults                        reference recipe
today        runs   51 h  1377 kPa   $20.62    wins   1113 / 1000 kPa  $18.25 of $21
abyss        runs   53 h   734 kPa   $24.53    wins    614 / 600 kPa  $21.56 of $23
psyche       runs   52 h  1341 kPa  $339.38    wins   1062 / 750 kPa  $290.81 of $300
undercity    runs   51 h   899 kPa   $22.84    wins   1622 / 1500 kPa  $27.52 of $31
caretaker    runs   51 h  1116 kPa   $36.16    wins   1275 / 1200 kPa  $30.29 of $32
```

Today is the tutorial: its defaults win, narrowly, if you keep the binder and
the balls topped up. Every other world starts over budget or under strength,
and finding the recipe is the game. A world with no winning recipe would be a
bug in the world, not a hard level.

## Today's flowsheet

```
  mill tails ──► THICKENER ──► U/F SURGE ──► PLATE PRESS ──► CAKE BIN
   180 t/h        18 m Ø        260 m³        120 m² cloth       │
   @ 32% Cw          │              │              │             │
                     │              └── filtrate ──┤             │
                     └── overflow ────────────────►│             │
                                                   ▼             ▼
                                          PROCESS WATER ───► MIXER ◄─── BINDER SILOS
                                             (recycle)          │          2 × 210 t
                                                                ▼
                                                          PASTE HOPPER  agitated
                                                                ▼
                                                   PASTE PUMPS 01A / 01B  duty + standby
                                                                │   190 m³/h, 120 bar
                                                                │
                                                     1,200 m developed
                                                       250 m vertical drop
                                                                ▼
                                                      STOPE 14-2 NORTH  6,000 m³
```

In front of it sits the circuit that *makes* the tailings — ball mill,
flotation bank, deslime cyclones — and a ball hopper you have to keep filled.

The back end is laid out from a real plant's model, and stacked the way a real
one is so that everything below the mixer runs on gravity: the twin-shaft mixer
on the top deck of a braced steel tower, an agitated paste hopper hung under
it, and a duty and a standby piston pump on the ground under that, fed through
a Y-piece. The stair goes up the face the control room looks at, the motor
control centre sits under the mid deck, the pumps' hydraulic packs and oil
cooler stand beside them, and a maintenance crane runs over the top — pulling
material cylinders is the job a paste pump needs most. Binder comes from two
silos on braced lattice legs, each with its own screw up to the mixer, and the
services run on a pipe rack along the north side. The handrails are safety
yellow, because they are.

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
| Static head recovery | `ρgΔz` — the only reason a 1,200 m paste line is possible at all. `g` is the world's own, so on Psyche it is 1.5% of Earth's | [rheology.ts](src/sim/rheology.ts#L163) |
| 28-day UCS | `UCS = k·Bd^1.4·exp(c·(Cw − Cw₀))`, after Belem & Benzaazoua | [rheology.ts](src/sim/rheology.ts#L180) |
| Thickener | Settling flux vs rise rate, flocculant-dependent underflow ceiling, rake torque | [plant.ts](src/sim/plant.ts) |
| Plate press | Capacity ∝ `1/√(cycle time)`, cake moisture falling with it | [plant.ts](src/sim/plant.ts) |
| Pipe wear | `∝ V^2.4 · (0.35 + Cv)`, eating the bore over the shift | [rheology.ts](src/sim/rheology.ts) |
| Cure temperature | A maturity factor on the 28-day strength: 0.66 at 2 °C on the seabed | [plant.ts](src/sim/plant.ts) |
| Dewatering cyclones | Inline, no bed: underflow capped at 60% solids, and the fines lost to overflow climb as the spigots tighten | [plant.ts](src/sim/plant.ts) |
| Decanter centrifuge | Inline: the cake ceiling rises and the centrate clears with polymer dose; scroll torque in place of rake torque | [plant.ts](src/sim/plant.ts) |
| Dry feed | No dewatering at all: the cake is the crushed feed, and every cubic metre of mix water is bought | [plant.ts](src/sim/plant.ts) |
| Grind | Bond's law: `W = 10·Wi·(1/√P80 − 1/√F80)` | [upstream.ts](src/sim/upstream.ts) |
| PSD | Gates-Gaudin-Schuhmann: `F(x) = (x/k)^m` | [upstream.ts](src/sim/upstream.ts) |
| Cyclone | `d50c ∝ 1/√P`, with a 28% fines bypass to underflow | [upstream.ts](src/sim/upstream.ts) |
| Flotation | Mass pull from head grade, recovery and concentrate grade | [upstream.ts](src/sim/upstream.ts) |
| Magnetic drum | Recovery tied to liberation of the metal from the silicate | [upstream.ts](src/sim/upstream.ts) |
| Liberation | Recovery falls away past a 140 µm P80 (locked composites) and below 60 µm (slimes) | [upstream.ts](src/sim/upstream.ts) |
| Mill power | Bond charge-filling law, P ∝ J·(1 − 0.937J), so an under-charged mill grinds coarser | [upstream.ts](src/sim/upstream.ts) |

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

The worlds all play the same way, so this is Today's, where the numbers are
easiest to check against a real plant.

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

## The circuit that makes the tailings

The plant is not handed a tailings stream. Today, it gets the circuit that
makes one:

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

That last pair is the decision this circuit exists for: your flotation is
running badly, so either fix the flotation or pay for a binder that does not
care.

The grinding power and the grinding media are inside your cost boundary, which
is why a cubic metre costs more here than in the fixed-feed runs of
`verify:scenarios` and `verify:solve`. Those harnesses still use the old
standard mode — a fixed tailings stream — because it isolates the backfill
plant; the app itself no longer offers it.

## The control room

Every world opens here, once its opening has played. You can leave any time with `Esc`, and get back
by clicking the hut on the pad or pressing **C**. The camera is *inside* the
building, at eye height in the chair, looking out through the real glass.
**Drag to look around**: the camera turns and never moves, the way your head
does when you are sitting down.

```
  ┌──────────── glass ────────────┐   the plant, still running, out the window
  │ 00  W A R N I N G S           │   double width, above the working screens
  │  01 MIMIC      │  02 SETPOINTS │
  │  03 INVENTORY  │  04 PROCESS   │
  └──────────── desk ─────────────┘   start/stop, speed, the phone, pilot lamps
```

Every screen has a **minimise** and a **maximise** button. Maximise one and it
fills the wall — the mimic in particular is worth blowing up. Minimise drops it
to a pill on the desk edge; clear all four and you are simply sitting at a
window watching the plant run.

- **00 Warnings** — 24 lamps and the event log, in a banner the width of the
  whole wall and mounted above the working screens. That is where a real alarm
  banner goes, and for the reason you would expect: you read the screens with
  your eyes down, catch it flashing at the top of your vision, and have to lift
  your head to find out what it is. Fold it away and the header keeps flashing
  and keeps the count, because a banner you can silence by folding it is worse
  than no banner at all.
- **01 Mimic** — the whole flowsheet as tiles, every one carrying its live
  numbers, outlined amber or red when a condition stands against it.
- **02 Setpoints** — the same nine loops as the side console, tagged the way
  they would be on a real mimic (WIC-101, DIC-320, QIC-610…). They *are* the
  same setpoints: both screens build from one spec list and write straight into
  the plant, so moving one moves the other.
- **03 Inventory** — eight trends of everything that fills or empties: surge
  tank, process water, thickener bed, filter cake bin, binder silo, ball
  hopper, the stope, and the running spill total.
- **04 Process** — eight trends of what you hold a setpoint against: UCS,
  discharge pressure, placement rate, slump, paste solids, line velocity, rake
  torque and cost of fill.

Sixteen traces over six shift-hours, drawn as small multiples rather than a
stack of strips — at eight traces to a screen a full-width strip is thirty
pixels tall and tells you nothing, where a card twice as tall and half as wide
still has a readable shape and room for the number.

### The phone

Consumables do not appear because you wished for them: somebody has to ring the
supplier, and from the chair that is you. The desk phone orders **binder** and
**balls** (hammers, in 2805), the same two deliveries as the side console, and the handset lights
up when either is getting low. There is a real one on the desk beside it, and
its message lamp blinks at the same time.

### The rest of the room

Turn far enough and you are looking at an end wall rather than the video wall,
which is the point of being able to turn at all. There is a sign counting the
hours since the last plug — wired to the blockage counter, and the most honest
instrument in the building — a motivational poster, a laminated thing somebody
printed years ago about adding more water, the shift board, a hi-vis on its
hook, a kettle on the filing cabinet, the traffic cone the shift board
complains about, and a pot plant that did not survive commissioning.

The walls are per world. Station Nereid's hut sits in a pressure sphere with
fish drifting past, and the shift board is logging them (47 so far). On Psyche
the motivational poster is about escape velocity, which is 166 m/s. In the
Undercity the shift board belongs to Meridian Holdings, and enthusiasm is
monitored. On the Last Shift it is day 255,500, and the kettle still works.
The mimic, the lamps and the trends are built from the world's flowsheet too:
no frother loop on the seabed, a hammer store instead of a ball hopper in 2805,
a plume trend wherever fines can leave the plant.

The look is clamped at 74.5°, and that is not a taste decision. The overlay is
placed with `tan(yaw)`, which is what keeps it pixel-sharp, and `tan` blows up
at a right angle.

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

Look is clamped at 74.5° of yaw either way, about 23° up and 24° down. `↻ Centre` squares you back up; `Esc` or
**Leave the desk** puts you back outside.

## Walking the plant

Press **F** — or *Walk the plant* on the console, or *Walk out* in the control
room — and you step out of the control-room door on foot, through the gate in
the pad kerb and onto the plant. Climb the mixing tower, stand on the mixer
deck, walk under the pumps. The plant keeps running while you do: the numbers
along the bottom stay up, and **E** on anything opens its inspector where you
are standing. **E** at the control room takes you back to the desk.

```
  mouse          look                 E       inspect what the crosshair is on
  W A S D        walk                 R       back to the door
  Shift          run                  Esc     let go of the mouse
  Space          jump                 F       stop walking
```

It feels different in each world. On the seabed you are in a hardsuit at 440
bar — slow, heavy, and a jump is a long float down. On Psyche you wear mag
boots that hold you to the iron while you walk; jump and they let go, and you
go up nearly five metres.

The collision world is the plant itself — there is no second, simplified
model to keep in step with the one you see. It is built the first time
someone steps out, since most people never do:

- **What you bump into** is every mesh in the world, less what should not be
  solid: anything see-through (glass, domes, light cones), process liquor
  (walk into a thickener and you go in it, not across it), the sky, and
  anything that moves, which carries `userData.noCollide`. The ground and the
  stair ramps carry `userData.collider` to be let in regardless; instanced
  meshes stay out unless they carry `userData.solid` — the asteroid rocks and
  the rubbish cubes do, the fish do not.
- **It is a grid, not an octree.** three's `Octree` does the same job, but on
  130,000 triangles it took seven seconds to build — a handful of huge
  triangles (the ground, the pad) land in every leaf they cross, and the tree
  splits sixteen levels deep everywhere they overlap. Bucketing triangles
  into 1.5 m cells is one pass, and the few big ones go on a short list
  checked by bounding box. The capsule-triangle test is still three's.
- **You are a capsule** 1.8 m tall and 0.7 m across, eyes at 1.62 m, stepped
  five times a frame. Floors push you straight up rather than along their
  normal — along the normal, a stair is a slide and standing still on one
  carries you down it. Kerbs up to 45 cm you step up without jumping.
- **Stairs carry an invisible ramp** laid just over the nosings, so you glide
  up them rather than catching on every tread, and it meets each landing
  flush rather than ducking under the landing's edge beam.

`node tools/walk.mjs` walks every world headlessly — out of the door, a jump,
and all the way up the tower stair.

## Paste Wars

After the shift, the plant gets used for something else. **`/?arena`** opens
Paste Wars: splat tag on the backfill plant, up to fifteen people at once in
one shared room, first person, no sign-in. It has its own strip on the title
screen, under the five worlds, with a live count of who is on shift.

The arena is the plant itself: the thickener, surge tank, filter press, cake
bin, binder silos, mixing tower and paste pumps all stand where they always
do, and all keep running through the fight — the rake turns, the press drops
cake, the lines flow. A site fence goes round the pad, and the two open yards
either side of the plant are dressed with what a real site leaves lying
about: containers (a crib room you can run through, and a pair with a crate
staircase up onto the roof), bulk bags of binder, jersey barriers, cable
drums, pipe spools, and stockpiles of filter cake off the press.

- **Paste gun** (click, hold for more): fast, a little arc, 16 a hit, six a
  second. The hopper on top has a sight glass, and it empties as you fire.
- **Rocks** (right click): slow and loopy, 45 a hit, one every 0.65 s.
- **Hard hats count** — a hit on the head is half as much again.
- **Nothing is free.** You start a life with 30 paste and 3 rocks. **Filter
  cake** lying on the stockpiles and round the yards fills the paste gun, 20 at
  a time; **rock piles** give three rocks. Walk over them. They come back 12–15
  s after someone takes them. There is no ammo on top of the mixing tower,
  which is the only thing stopping it being a sniper's nest.
- 100 health, coming back after five seconds out of trouble; 2 s of spawn
  shield (gone the moment you throw); 4 s on the floor when you are plastered,
  with the camera lifting off to look at whoever did it. A hit of paste gums
  your boots up for a second.
- **Rounds** are five minutes and start once two are on shift. Each one draws
  its conditions: Earth, then **Psyche gravity** — the walker's own low-g feel,
  a jump of nearly five metres, and every lump flying flat — and back again.
  Twelve seconds of scoreboard between rounds, and a name for whoever took the
  shift.
- **Names are handed out**, never typed: *Fitter 14*, *Shift Boss 3*,
  *Crib Cook 71*, with a hard hat in one of fifteen colours. There is no chat.
  Nothing anyone types ever reaches anyone else, so there is nothing to
  moderate.

```
  mouse          look                 click         paste gun
  W A S D        move                 right click   throw a rock
  Shift          run                  1 2 Q wheel   swap
  Space          jump                 Tab           scores
  Esc            let go of the mouse  M             sound
```

With no server to be found — `npm run dev` without `npm run arena`, or the
arena container down — the page says so and runs a room of its own, in the
page, on the same code: practice plays by exactly the rules the real thing
does. If the room is full it does the same, and keeps asking the server until
a slot comes up.

### How the room works

The whole game is one transport-free class, `src/arena/shared/room.ts`. The
arena server wraps it in WebSockets; the practice room wraps it in a loopback
that still goes through JSON both ways. What each end owns:

- **Movement belongs to the page.** Every player runs the same walker as
  *Walking the plant* and reports where it got to twenty times a second. The
  room checks nobody is moving faster than their legs allow — a leaky
  distance budget, not a per-message speed, so a burst of reports held up in a
  queue does not read as a teleport — and sends back a `fix` when they are.
- **Everything that decides a fight belongs to the room**: ammo, every lump in
  the air, every hit, health, respawns, pickups and the round clock. A throw is
  a direction; the room flies the lump at 60 Hz against the collision world
  and the players' capsules, and says where it ended.
- **Both ends fly lumps with the same physics** (`shared/physics.ts`) against
  the **same triangles**. The server has no renderer and cannot build the
  plant, so `npm run bake` builds the arena in a headless browser, clips the
  collision world to the fence, and writes the triangles out
  (`server/worlds/arena.bin.gz`, 85,000 triangles, 0.6 MB). The page builds its
  own from the same meshes, and both fingerprint it to the centimetre — a
  page whose plant does not match the server's bake says so in the console.
  A lump you see splat on a girder splatted on that girder on the server.
- **Your own throws fly the moment you let go**, on your clock, drawn from the
  muzzle and easing onto the true path. Everyone else is drawn 110 ms in the
  past from the server's snapshots, so there is always a pair to blend
  between — and their throws are flown on that same delayed clock, so a lump
  leaves someone's hands when you see them throw it, and splats on you when
  the server said it did. Slow lumps hide latency far better than hitscan
  would, which is why there is no lag compensation and no need for it.
- **Anyone with the link can connect**, so the door is where the limits are:
  an origin check, six sockets and twenty joins a minute per address, 2 kB
  messages, a token bucket of sixty messages a second, a kick for junk, a
  ping for dead sockets, and three minutes stood still before your slot goes
  to someone else. A dropped connection holds its slot for twenty seconds, so
  a refresh gets you the same name, hat and score back.

`npm run verify:arena` checks the map against the bake (every spawn is open
standing room; every pickup lies on something you can stand over), then
plays the server with scripted bots over real sockets — join, round start, a
hit, a tag and a respawn, a lump stopped by a container, a hopper run dry and
refilled on cake, a teleport refused, junk, a flood, the sixteenth player
turned away, and the per-address cap. `node tools/arenapage.mjs` puts two
headless browsers in the room and has one paste the other.

## Running it

```bash
npm install
npm run dev        # http://localhost:5180
npm run arena      # the Paste Wars server on :8481 - the dev server proxies /play to it
```

```bash
npm run build      # static bundle in dist/
npm run typecheck
npm run verify     # the five physics harnesses, outside the browser
npm run bake       # re-bake the arena's collision world after changing anything on the pad
npm run verify:arena
```

**Controls** — pick a world, watch or skip the opening, and it sits you in the
control room; `Esc` leaves the desk and **↺ Worlds** goes back to the title
screen. Outside, drag to orbit, scroll to zoom, click any unit to inspect it.
`Space` run/stop, `1`–`5` time compression (pause → 240×), `O`/`P`/`U` for the
overview, plant and destination views, `G` for the front end (the mill, the
collector, the old dam or the piles), `C` for the control room, `F` to walk,
`Esc` to deselect or to leave the desk.

In the control room, drag to look around — you turn but never move.

## Putting it on the server

PasteWorks is a static bundle that runs entirely in the browser, plus one
small WebSocket server for Paste Wars — no API, no database, **no sign-in**.
So it is the simplest stack on the box: an nginx container on
`127.0.0.1:8480` and the arena on `127.0.0.1:8481`, with the host nginx
proxying `https://pasteworks.minesmart.cloud` to the first and `/play` to
the second, and certbot terminating TLS. Same shape as the other apps there,
each of which owns a decade of loopback ports — assetpro 8410, pidpro 8420,
pipelinepro 8430, portal 8440, processpro 8450, Keycloak 8460, bowtie 8470 —
minus everything those need and this does not. The arena keeps one game in
memory and nothing else: no accounts, no volume, nothing to back up.

Nothing is provisioned in the `Identity` repo. No Keycloak client, no audience
scope, no group. Anyone with the link opens it, which is the point.

```
  infra/deploy/
    docker-compose.yml                       web and arena, a port each
    web/Dockerfile                           node build -> nginx runtime
    web/nginx.conf                           gzip, immutable assets, /healthz
    arena/Dockerfile                         node build -> one bundled file and the bake
    nginx/pasteworks.minesmart.cloud.conf    the host vhost, with the /play WebSocket
    build-push.ps1                           build on a workstation, push to ghcr
    redeploy.sh                              pull and restart on the server
    README.md                                the walkthrough
```

Full instructions are in [infra/deploy/README.md](infra/deploy/README.md). The
short version, once DNS points at the box:

```powershell
cd infra\deploy; .\build-push.ps1          # on a workstation
```

```bash
cd /home/ben && git clone https://github.com/Jacob12244/PasteWorks.git pasteworks
cd pasteworks/infra/deploy && docker compose pull && docker compose up -d
sudo cp nginx/pasteworks.minesmart.cloud.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/pasteworks.minesmart.cloud.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pasteworks.minesmart.cloud
```

After that, `./redeploy.sh` is the whole update cycle. There is no `.env` to
fill in and nothing to back up.

Already running a PasteWorks from before Paste Wars? `./redeploy.sh` brings
the arena container up on its own; the one hand step is adding the `/play`
location to the live host vhost — see *Adding Paste Wars to a running server*
in the deploy README.

## How it is built

No asset pipeline. Every vessel, walkway, handrail, ladder and pipe spool is
generated from primitives at load time, so the whole plant is code:

```
src/
  sim/
    streams.ts     three-component stream algebra
    upstream.ts    every front end: mill, flotation, magnet, collector, dredge, crusher
    rheology.ts    yield stress, slump, Bingham pipeline, UCS
    plant.ts       unit operations, inventories, alarms, the tick loop
  scenario/
    types.ts       what a world is made of
    today.ts       ... abyss.ts, psyche.ts, undercity.ts, caretaker.ts - pure data
    index.ts       the list, in date order, and applyScenario()
    flowsheet.ts   sheet(): which units, loops, lamps and trends this world has
  view/
    palette.ts     one palette: cold structure, warm process
    parts.ts       platforms, railings, ladders, level bars, holographic tags
    flow.ts        travelling-band pipe shader, driven from real velocity
    particles.ts   pooled point-sprite system for every failure mode
    spill.ts       a vessel overflowing: streams, splash, puddle
    units.ts       thickener, surge tank, press, cake bin, twin silos, mixing tower, pumps
    dewater.ts     the cyclone bank and the decanter centrifuges
    upstream.ts    ball mill, flotation bank, magnetic drums, deslime cyclones
    fronts.ts      seabed collector and riser, the old dam and its dredge, the piles
    deliveries.ts  tanker, pod, lander, drone, teleport
    worlds/        seabed, asteroid, city, wasteland: terrain, sky and things that move
    terrain.ts     ground, rock block model, borehole, stope
    world.ts       site layout and interconnecting pipework, per flowsheet
    room.ts        what is on the control room walls, world by world, and the phone
    scene.ts       renderer, IBL, per-world lighting, bloom
    walk.ts        on foot: the collision world, the capsule
    grid.ts        the triangle grid: capsule and segment tests, no DOM, shared with the server
    feel.ts        how being on foot feels in each world
  arena/           Paste Wars (only loaded for ?arena)
    shared/        rules, map, protocol, physics and the room itself - page and server alike
    arena.ts       the mode: boot, the line to the room, throwing, the frame loop
    props.ts       containers, crib room, bags, barriers, cake stockpiles, fence, pickups
    avatars.ts     everyone else, in hi-vis, drawn from snapshots
    lumps.ts       everything in the air, and the splats
    viewmodel.ts   the paste gun in your hands, with its sight glass
    hud.ts         health, ammo, round clock, feed, scoreboard, pause card
    net.ts         the socket, and the practice room when there is no socket
    sound.ts       every noise, synthesised
  ui/
    welcome.ts     the title screen
    cutscene.ts    the opening: letterbox, typed text, cuts, objective card
    walkui.ts      the crosshair, the prompt, the keys, the pause card
    setpoints.ts   the loops, described once, shared by both consoles
    hud.ts         side console, alarm log, per-unit inspector
    scada.ts       the control room: warnings, mimic, trends, video wall
```

```
server/
  main.ts          the arena server: /play, /healthz, /play/status, and the limits
  worlds/          the baked collision world the room plays against
```

**A world is data.** A scenario file overrides the plant's design constants,
the ore, the starting setpoints and a handful of names, and `applyScenario()`
restores a snapshot of the defaults before applying one, so worlds never leak
into each other. The scenario files do not import Three.js, which is what lets
the verification harnesses load them in Node. `sheet()` then works out from
the flowsheet which sliders, mimic tiles, lamps and trends exist, and the 3D
world reads the same sheet to decide which units to build — a frother slider
cannot turn up on the seabed, because nothing in the seabed flowsheet floats.

A few things worth knowing if you pick it up:

- **Metals need image-based lighting.** `MeshStandardMaterial` with high
  metalness and no environment map renders black. A PMREM of the stock
  `RoomEnvironment` is most of the difference between "3D shapes" and "a plant".
- **Flow bands are spaced in UV**, and a tube's UV runs 0..1 whatever its real
  length, so band count is derived from length (`bandsFor`) or a 5 m spool looks
  like a caterpillar track.
- **The ground plane has a hole punched in it** over the section, otherwise it
  quietly roofs over the stope. It is built in (x, −z) and turned by −90°:
  turned the other way it faces down, and back-face culling hides it from
  every camera above ground, which is all of them.
- **Alarms latch.** They log once when a condition comes in and once when it
  clears, the way an annunciator does — not on every scan. The warnings banner
  then reads the standing set directly, so the lamps and the log can never
  disagree.
- **The scene blooms anything over 0.72 luminance**, so a poster printed on
  white paper and lit by the room light is a white rectangle with a halo. Every
  light surface in the control room is printed on card instead, around 0.70
  sRGB, with the emissive turned right down.
- **`Capsule.copy()` returns nothing.** The typings say it returns the
  capsule; the code does not. `const c = tmp.copy(other)` is `undefined`.
- **Canvases must be sized from the content box.** `getBoundingClientRect`
  includes the padding; a canvas sized from it sits inside the padding and
  overhangs its panel by exactly that much — which is the last column of
  numbers, sliced off.
- **A background tab stops animating.** Headless tests that open two pages
  in one browser find the first one idle-kicked: its `requestAnimationFrame`
  stopped the moment the second took focus, and with it the position reports.
  Give each player a browser of its own.
- **The first visit to `?arena` under `npm run dev` reloads once.** Vite only
  finds the arena's imports (the post-processing passes) when the chunk
  loads, pre-bundles them, and reloads the page — which rejoins under the same
  name. It does not happen in a build.
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
4. Press **G**. The mill drum turns, the flotation bank works a froth into its
   launders, and the cyclone cluster lights up when it is in circuit. Bypass
   the deslime and watch every number downstream get worse at once.
5. Back in the control room, run it at 240× and do *not* pick up the phone. The
   ball hopper empties around hour 33, nothing trips, and you can watch the
   hopper trace hit the floor on screen 03 while the UCS bends down on 04 and
   the mimic's P80 climbs.
6. Press **↺ Worlds** and go to Station Nereid. Tighten the cyclone underflow
   for a denser paste and watch the plume trend — and the cost — climb with
   it. Then try Mass Driver One and find out what water costs when it came
   from an ice moon.
