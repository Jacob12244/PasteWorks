# Verification harnesses

The process model is the part of PasteWorks that has to be right, so it is
checked outside the browser.

| script | what it answers |
| --- | --- |
| `check.ts` | Do the rheology and hydraulics land in the band a real paste plant runs in? Prints a yield-stress / slump / UCS sweep, a pipeline table, and a 24 h run at the default setpoints. |
| `scenarios.ts` | Does each setpoint actually trade off against the others? Runs 12 h at a range of deliberately good and bad settings. |
| `solve.ts` | Is the objective winnable, and is there a single best answer? Grid-searches binder dose, slump target and stroke rate for on-spec, blockage-free, cheapest fills. |
| `hardmode.ts` | Does the upstream circuit trade the way it should? Sweeps grind, flotation, deslime cut and ball-charge condition, then runs nine full fills — including two that never order grinding media. |

```
npm run verify        # all four
npm run verify:check
npm run verify:scenarios
npm run verify:hard
npm run verify:solve
```

`shot.mjs` drives headless Chrome to screenshot the running app:

```
npm run build && npx vite preview --port 5190 &
node tools/shot.mjs http://localhost:5190/ shot.png 6000 "PW.hud.onView('stope')"
```

The page exposes `window.PW = { plant, stage, world, hud, scada, sitDown, THREE }`
for exactly this sort of poking about. A couple that are handy:

```js
PW.hud.setHard(true);                       // hard mode
PW.plant.sp.running = true;
for (let i = 0; i < 900; i++) PW.plant.step(30);   // fast-forward 7.5 h
PW.sitDown(true);                           // into the control room
PW.scada.update(PW.plant.telemetry, 60);    // force a SCADA repaint
```

Note that `shot.mjs` screenshots ~2.5 s after running the script, so anything
that needs sim time must be stepped synchronously rather than left to run.
