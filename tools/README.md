# Verification harnesses

The process model is the part of PasteWorks that has to be right, so it is
checked outside the browser.

| script | what it answers |
| --- | --- |
| `check.ts` | Do the rheology and hydraulics land in the band a real paste plant runs in? Prints a yield-stress / slump / UCS sweep, a pipeline table, and a 24 h run at the default setpoints. |
| `scenarios.ts` | Does each setpoint actually trade off against the others? Runs 12 h at a range of deliberately good and bad settings. |
| `solve.ts` | Is the objective winnable, and is there a single best answer? Grid-searches binder dose, slump target and stroke rate for on-spec, blockage-free, cheapest fills. |
| `hardmode.ts` | Does the upstream circuit trade the way it should? Sweeps grind, flotation, deslime cut and ball-charge condition, then runs nine full fills — including two that never order grinding media. |
| `sizing.ts` | Does the sizing game run ProcessPro's models right, and can every contract be won? Rebuilds ProcessPro's crushing example to within 1%, then has a plain designer close 50 random contracts. Not part of `verify`: it takes about a minute. |
| `worlds.ts` | Can every world be won? Runs each scenario to the end at its defaults and at a reference recipe, operating the plant the way a sensible operator would. `solve:worlds [id]` does the full binder × slump × stroke sweep instead. |

`check`, `scenarios` and `solve` run Today's plant on a fixed tailings stream
(the old standard mode), which isolates the backfill plant from the circuit in
front of it. The app itself always runs the full circuit.

```
npm run verify        # all five
npm run verify:check
npm run verify:scenarios
npm run verify:hard
npm run verify:solve
npm run verify:worlds
npm run solve:worlds -- abyss
npm run verify:sizing
```

Three scripts drive headless Chrome against a running dev server
(`npm run dev`, port 5180). Add `?s=<world>&intro=0` to the URL to skip the
title screen and the opening.

```
node tools/shot.mjs "http://localhost:5180/?s=today&intro=0" shot.png 6000 "PW.hud.onView('stope')"
node tools/shots.mjs "http://localhost:5180/?s=psyche&intro=0" out '[{"name":"pit","pos":[-150,26,44],"at":[-118,4,-8]}]'
node tools/story.mjs undercity story-undercity.png
node tools/walk.mjs today psyche
```

- `sizingpage.mjs` — a screenshot of each sizing station and its checks:
  `node tools/sizingpage.mjs "http://localhost:5180/?size=4821" out`.
- `shot.mjs` — one screenshot, after running a script.
- `shots.mjs` — several camera positions from one browser session; each shot
  leaves the desk first unless it says `"seated": true`.
- `story.mjs` — a contact sheet of a world's opening, the first and last frame
  of every beat, with the consoles hidden. A beat whose camera lands on nothing
  is obvious at a glance.
- `walk.mjs` — walks every world on foot: out of the door and through the
  gate, a jump, and up both flights of the tower stair. Headless Chrome cannot
  take the pointer and renders too slowly to walk in real time, so it
  unpauses the walker by hand and steps it at 60 fps inside the page. Exits
  non-zero if anything fails.

The page exposes `window.PW = { plant, stage, world, hud, scada, sitDown, CONTROL, THREE, scenario, cut, look, walker, walk }`
for exactly this sort of poking about. A few that are handy:

```js
PW.scenario.id;                             // which world
PW.cut?.skip();                             // end the opening
PW.look(40, 10);                            // turn the operator's head, degrees
PW.walk(true);                              // out of the door, on foot
PW.walker.respawn();                        // back to the door
PW.plant.sp.running = true;
for (let i = 0; i < 900; i++) PW.plant.step(30);   // fast-forward 7.5 h
PW.sitDown(true);                           // into the control room
PW.scada.update(PW.plant.telemetry, 60);    // force a SCADA repaint
```

Note that `shot.mjs` screenshots ~2.5 s after running the script, so anything
that needs sim time must be stepped synchronously rather than left to run.

## Paste Wars

```
npm run bake                      # both collision worlds -> server/worlds/arena.bin.gz, mine.bin.gz (dev server up)
npm run verify:arena              # both maps against their bakes, then the server against bots
node tools/arenapage.mjs out      # two browsers on the plant (dev server and npm run arena up)
node tools/minepage.mjs out       # two browsers in the mine: a barrow the length of the level
npm run mine:plan                 # the 760 Level's plan as a PNG, straight from its field
```

- `bake.mjs` — opens `?arena=bake` and `?arena=bake-mine`, which build each
  map exactly as a player's page does and clip its collision world, and
  writes the triangles out for the server with their fingerprints in
  `arena.json` and `mine.json`. Re-bake after changing anything in either: a
  prop, a spawn's surroundings, a unit in the plant, a drive in the level. A
  page whose world no longer matches says so in the console when it joins.
  `node tools/bake.mjs http://localhost:5180/ mine` bakes just the one.
- `arenamap.ts` — every spawn is open standing room with floor under it and
  inside the fence; every pickup lies on something, with somewhere to stand
  within reach of it. Catches a prop dropped on a spawn, and a cake put under
  a table. In the mine it also floods the level's walkable floor out from
  every spawn: each must reach its own barrow and the other crew's stope, and
  nobody may get into a stope past its barricade.
- `mineplan.ts` — draws the 760 Level's plan from its distance field, with
  the fill points, pours, spawns, pickups and props marked. No browser; for
  laying the level out.
- `arena.mjs` — starts its own server on a spare port and plays it with
  scripted bots over real sockets: join, round start, a hit, a tag and a
  respawn, a lump stopped by a container, a hopper run dry and refilled on
  cake, a teleport refused, junk and a flood shown the door, the sixteenth
  player turned away, and a second server's per-address cap.
- `arenapage.mjs` — two headless browsers join the running room, see each
  other, and one pastes the other; screenshots from both sides. A browser
  each, because a second tab is a background tab, a background tab stops
  animating, and the room reads that as idling.
- `minepage.mjs` — the same in the mine: the two land on opposite crews, Day
  takes its barrow, Night sees it taken and watches it go past, Day pushes it
  the length of the level into Night's stope and both pages score the pour.
  Then a real walker runs flat out into the rock, and at a stope's barricade,
  and has to stop.

In the arena the page exposes `window.PW = { stage, walker, avatars, lumps, hud, grid, hash, vm, pickups, barrows, minimap, map, THREE, conn, me, ammo, round, roster, carrying, ts, fire, setWeapon, practise, grab }`, plus `plant` and `world` on the plant and `mine` in the mine:

```js
PW.walker.paused = false; PW.walker.onPause(false);   // headless: no pointer lock to wait for
PW.walker.moveTo(new PW.THREE.Vector3(x, 0.05, z));    // small steps - the room refuses a teleport
PW.fire(0);                                            // paste, where the camera looks
PW.practise('why');                                    // drop the server, play in the page
PW.grab();                                             // the mine: E - take hold of the barrow, or let go
```
