/**
 * Deliveries, the way each era does them.
 *
 * Ring the phone for binder or grinding media and something has to bring it.
 * Today that is a tanker truck. At 4,400 m it is a pod lowered on a cable
 * from the ship. On Psyche it is a lander. In Meridian it is a heavy-lift
 * drone over the traffic. And long after everyone left, it is a teleport pad -
 * which is why water is still hauled by tanker in that world: the pad has the
 * power for a few tonnes of binder, and nothing like the power for a lake.
 *
 * The sim only ever sees the silo or the hopper fill. This is the show.
 */
import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import type { WorldKind } from '../scenario/types';
import { C, metal, matte, glow, glowUnique } from './palette';
import { box, cyl } from './parts';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (k: number) => k * k * (3 - 2 * k);

interface Trip {
  kind: 'binder' | 'media';
  age: number;
  vehicle: THREE.Group;
  target: THREE.Vector3;
  fx?: THREE.Mesh;
}

/** How long a trip takes on screen, seconds. */
const TRIP = 10;

export class Deliveries {
  private trips: Trip[] = [];
  private seen = new Set<string>();
  private pad?: THREE.Group;
  private padGlow?: THREE.MeshStandardMaterial;

  constructor(
    private root: THREE.Group,
    private world: WorldKind,
    /** where a binder delivery goes, and where a media delivery goes */
    private binderAt: THREE.Vector3,
    private mediaAt: THREE.Vector3,
  ) {
    if (world === 'waste') this.buildPads();
  }

  /** The teleport pads, which sit there looking expectant between deliveries. */
  private buildPads() {
    this.pad = new THREE.Group();
    this.padGlow = glowUnique(0x7affd8, 0.6);
    for (const at of [this.binderAt, this.mediaAt]) {
      const base = cyl(3.2, 3.6, 0.5, metal(0x3c4652, 0.5, 0.8), 32);
      base.position.set(at.x, 0.25, at.z);
      this.pad.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.14, 8, 40), this.padGlow);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(at.x, 0.55, at.z);
      this.pad.add(ring);
    }
    this.root.add(this.pad);
  }

  update(t: Telemetry, dt: number, time: number) {
    // a delivery is the sim's own "received" event
    for (const a of t.alarms) {
      if (a.id !== 'silo-fill' && a.id !== 'media-fill') continue;
      const key = a.id + '@' + a.at.toFixed(1);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      // anything already in the log when we started is history, not a trip
      if (time < 1) continue;
      this.launch(a.id === 'silo-fill' ? 'binder' : 'media');
    }
    if (t.time < 1 && this.seen.size) this.seen.clear();   // a reset

    for (const tr of this.trips) {
      tr.age += dt;
      this.animate(tr, time);
    }
    for (const tr of this.trips.filter((x) => x.age > TRIP)) {
      this.root.remove(tr.vehicle);
      if (tr.fx) this.root.remove(tr.fx);
    }
    this.trips = this.trips.filter((x) => x.age <= TRIP);
    if (this.padGlow) {
      const busy = this.trips.length > 0;
      this.padGlow.emissiveIntensity = busy ? 2.5 + Math.sin(time * 14) * 1.5 : 0.5 + Math.sin(time * 1.5) * 0.2;
    }
  }

  private launch(kind: 'binder' | 'media') {
    const target = (kind === 'binder' ? this.binderAt : this.mediaAt).clone();
    const vehicle = this.vehicle(kind);
    vehicle.userData.noCollide = true;
    this.root.add(vehicle);
    const trip: Trip = { kind, age: 0, vehicle, target };
    if (this.world === 'waste' || this.world === 'ocean' || this.world === 'space') {
      // a beam: light for the teleporter, a cable for the pod, exhaust for the lander
      const col = this.world === 'waste' ? 0x7affd8 : this.world === 'space' ? 0xffb060 : 0x9fb8c8;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(this.world === 'ocean' ? 0.08 : 2.6, this.world === 'ocean' ? 0.08 : 2.6, 1, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.0, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }),
      );
      this.root.add(beam);
      trip.fx = beam;
    }
    this.trips.push(trip);
  }

  // ------------------------------------------------------------ vehicles

  private vehicle(kind: 'binder' | 'media'): THREE.Group {
    const g = new THREE.Group();
    const cargo = kind === 'binder' ? 0xd9d3c3 : 0x8c97a6;
    switch (this.world) {
      case 'ocean': {
        // a cargo pod with fins and a strobe, on a cable from the surface
        const pod = cyl(1.6, 1.6, 4, metal(0xe0b830, 0.5, 0.45), 18);
        g.add(pod);
        const cap = cyl(0.6, 1.6, 1.2, metal(C.steelDark), 18);
        cap.position.y = 2.6;
        g.add(cap);
        const band = box(3.3, 0.5, 3.3, glow(cargo, 1.2));
        band.position.y = -0.8;
        g.add(band);
        const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), glow(C.red, 3));
        strobe.position.y = 3.3;
        g.add(strobe);
        break;
      }
      case 'space': {
        // a squat lander: legs, tank, a thruster underneath
        const body = cyl(2.4, 2.8, 3, metal(0xc8ccd2, 0.4, 0.8), 8);
        body.position.y = 3;
        g.add(body);
        const tank = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), metal(0xd8a23a, 0.4, 0.6));
        tank.position.y = 5.2;
        g.add(tank);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const leg = box(0.25, 3.2, 0.25, metal(C.steelLight));
          leg.position.set(Math.cos(a) * 2.6, 1.3, Math.sin(a) * 2.6);
          leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
          g.add(leg);
        }
        const jet = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.4, 14, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
        jet.rotation.x = Math.PI;
        jet.position.y = 0.2;
        jet.name = 'jet';
        g.add(jet);
        const light = new THREE.PointLight(0xffb060, 80, 40, 2);
        light.position.y = -0.5;
        light.name = 'jetLight';
        g.add(light);
        break;
      }
      case 'city': {
        // a heavy-lift drone: four rotors, neon, and a container slung under it
        const frame = box(7, 0.6, 7, metal(0x1c1a24, 0.4, 0.8));
        g.add(frame);
        for (const [x, z] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]] as const) {
          const rotor = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.08, 20),
            new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
          rotor.position.set(x, 0.5, z);
          g.add(rotor);
          const hub = cyl(0.3, 0.3, 0.6, glow(0xff4fd8, 2.4), 10);
          hub.position.set(x, 0.3, z);
          g.add(hub);
        }
        const box1 = box(4, 2.4, 2.6, metal(cargo, 0.6, 0.5));
        box1.position.y = -3.2;
        g.add(box1);
        for (const x of [-1.8, 1.8]) {
          const sling = box(0.05, 2.6, 0.05, matte(0x333333, 0.9));
          sling.position.set(x, -1.6, 0);
          g.add(sling);
        }
        const beam = new THREE.PointLight(0xff4fd8, 40, 30, 2);
        beam.position.y = -1;
        g.add(beam);
        break;
      }
      case 'waste': {
        // what comes through the pad: a crate, briefly
        const crate = box(3, 2.4, 3, metal(cargo, 0.6, 0.5));
        crate.position.y = 1.2;
        g.add(crate);
        const edge = box(3.1, 0.2, 3.1, glow(0x7affd8, 2));
        edge.position.y = 2.45;
        g.add(edge);
        break;
      }
      default: {
        // today: a truck. A bulk tanker for binder, a flatbed of ball bins for media.
        const cab = box(2.6, 2.8, 2.6, metal(0xd84a2a, 0.5, 0.5));
        cab.position.set(4.8, 2.0, 0);
        g.add(cab);
        const chassis = box(10, 0.5, 2.4, matte(0x1a1a1a, 0.9));
        chassis.position.set(0.6, 1.0, 0);
        g.add(chassis);
        if (kind === 'binder') {
          const tank = cyl(1.3, 1.3, 7, metal(0xd9dde2, 0.35, 0.8), 20);
          tank.rotation.z = Math.PI / 2;
          tank.position.set(-0.8, 2.6, 0);
          g.add(tank);
        } else {
          for (const x of [-3, -1, 1]) {
            const bin = box(1.6, 1.4, 2, metal(0x5a6068, 0.6, 0.7));
            bin.position.set(x, 2.0, 0);
            g.add(bin);
          }
        }
        for (const x of [-3, 0, 4.8]) {
          for (const z of [-1.2, 1.2]) {
            const w = cyl(0.55, 0.55, 0.4, matte(0x1a1a1a, 0.9), 12);
            w.rotation.x = Math.PI / 2;
            w.position.set(x, 0.55, z);
            g.add(w);
          }
        }
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 2), glow(0xffe9c4, 3));
        lamp.position.set(6.12, 1.6, 0);
        g.add(lamp);
      }
    }
    return g;
  }

  // ------------------------------------------------------------ the trips

  private animate(tr: Trip, time: number) {
    const k = tr.age / TRIP;
    const T = tr.target;
    const v = tr.vehicle;
    const inK = ease(Math.min(1, k / 0.35));
    const outK = ease(Math.max(0, (k - 0.65) / 0.35));
    const beam = tr.fx?.material as THREE.MeshBasicMaterial | undefined;

    switch (this.world) {
      case 'ocean': {
        // down the cable from the dark, a pause over the silo, back up
        const top = T.y + 70;
        const y = k < 0.35 ? top - (top - T.y - 5) * inK : k < 0.65 ? T.y + 5 : T.y + 5 + (top - T.y - 5) * outK;
        v.position.set(T.x, y, T.z);
        v.rotation.y = time * 0.3;
        if (tr.fx && beam) {
          const len = top + 30 - y;
          tr.fx.scale.set(1, len, 1);
          tr.fx.position.set(T.x, y + 3.6 + len / 2, T.z);
          beam.opacity = 0.6;
        }
        break;
      }
      case 'space': {
        // down on a thruster, sit, lift off
        const top = T.y + 90;
        const y = k < 0.35 ? top - (top - T.y) * inK : k < 0.65 ? T.y : T.y + (top - T.y) * outK;
        v.position.set(T.x, y, T.z);
        const firing = k < 0.36 || k > 0.64;
        const jet = v.getObjectByName('jet');
        const jl = v.getObjectByName('jetLight') as THREE.PointLight | undefined;
        if (jet) jet.visible = firing;
        if (jl) jl.intensity = firing ? 80 + Math.random() * 40 : 0;
        if (tr.fx && beam) {
          beam.opacity = 0;
        }
        break;
      }
      case 'city': {
        // in over the skyline, hover and lower, off the other way
        const from = V(T.x - 160, T.y + 70, T.z - 120);
        const to = V(T.x + 170, T.y + 80, T.z - 90);
        const hover = V(T.x, T.y + 10, T.z);
        if (k < 0.35) v.position.lerpVectors(from, hover, inK);
        else if (k < 0.65) v.position.copy(hover).setY(T.y + 10 - Math.sin(((k - 0.35) / 0.3) * Math.PI) * 3);
        else v.position.lerpVectors(hover, to, outK);
        v.rotation.y = k < 0.35 ? -0.6 : k > 0.65 ? 0.5 : 0;
        break;
      }
      case 'waste': {
        // a column of light, the crate, the column again, and nothing
        v.position.set(T.x, 0.5, T.z);
        const shimmer = k < 0.3 ? k / 0.3 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        const solid = k > 0.25 && k < 0.8 ? 1 : 0;
        v.scale.setScalar(Math.max(0.001, solid ? 1 : shimmer * 0.3));
        v.visible = shimmer > 0.02;
        if (tr.fx && beam) {
          tr.fx.scale.set(1, 40, 1);
          tr.fx.position.set(T.x, 20, T.z);
          beam.opacity = Math.max(0, (k < 0.35 ? k / 0.35 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 0.6)) * 0.55
            * (0.8 + Math.sin(time * 30) * 0.2);
        }
        break;
      }
      default: {
        // along the pad edge, park by the silo, drive off
        const from = V(T.x - 120, 0, T.z - 22);
        const park = V(T.x - 8, 0, T.z - 8);
        const to = V(T.x + 120, 0, T.z - 22);
        if (k < 0.35) v.position.lerpVectors(from, park, inK);
        else if (k < 0.65) v.position.copy(park);
        else v.position.lerpVectors(park, to, outK);
        v.rotation.y = 0;
      }
    }
  }
}
