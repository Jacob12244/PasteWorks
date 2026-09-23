# Verification harnesses

The process model is the part of PasteWorks that has to be right, so it is
checked outside the browser.

| script | what it answers |
| --- | --- |
| `check.ts` | Do the rheology and hydraulics land in the band a real paste plant runs in? Prints a yield-stress / slump / UCS sweep, a pipeline table, and a 24 h run at the default setpoints. |
| `scenarios.ts` | Does each setpoint actually trade off against the others? Runs 12 h at a range of deliberately good and bad settings. |
| `solve.ts` | Is the objective winnable, and is there a single best answer? Grid-searches binder dose, slump target and stroke rate for on-spec, blockage-free, cheapest fills. |
| `hardmode.ts` | Does the upstream circuit trade the way it should? Sweeps grind, flotation, deslime cut and ball-charge condition, then runs nine full fills — including two that never order grinding media. |
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
