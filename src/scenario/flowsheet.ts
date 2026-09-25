/**
 * What this site's flowsheet actually has in it, in the words the consoles
 * should use.
 *
 * Read once the scenario has been applied. The side console, the SCADA and
 * the inspector all ask this rather than each deciding for themselves which
 * sliders, tiles and lamps exist - so a frother slider cannot turn up on a
 * plant with no flotation bank, or a rake torque on one with no rakes.
 */
import { DESIGN, bedded } from '../sim/plant';
import { ORE } from '../sim/upstream';
import type { BinderSpec } from '../sim/binders';

export interface Sheet {
  source: typeof ORE.source;
  separation: typeof ORE.separation;
  dewater: typeof DESIGN.dewater;
  filter: typeof DESIGN.filter;

  hasFrother: boolean;
  hasDeslime: boolean;
  /** flocculant, or polymer, or seeded floc - anything with a settling bed */
  hasFloc: boolean;
  /** an underflow density setpoint */
  hasUf: boolean;
  /** a second dewatering stage between the surge tank and the cake bin */
  hasPress: boolean;
  hasSurge: boolean;
  /** a settler with a bed: a thickener, a spin ring or a magnetic stack */
  hasBed: boolean;
  /** a consumable the grinder eats - balls or hammers */
  hasMedia: boolean;
  /** a limit worth watching - rakes, a ring's balance, or a stack's coils */
  hasTorque: boolean;
  /** fines leave the plant with an overflow or a filtrate, and are billed */
  hasPlume: boolean;
  /** the process water tank can overflow */
  canSpillWater: boolean;
  /** sulphides can reach the binder */
  hasSulphide: boolean;

  feed: { label: string; unit: string; hint: string };
  floc: { label: string; hint: string };
  uf: { label: string; hint: string };
  /** the limit the settler runs against: rake torque, ring imbalance, coil temperature */
  torque: { label: string; short: string };
  media: { button: string; short: string };
  /** the two binders the silo can hold */
  binders: [BinderSpec, BinderSpec];
  /** the view button for the front end: Mill, Collector, Old dam, Piles */
  frontButton: string;
  tiles: {
    source: string; separation: string; deslime: string; dewater: string;
    filter: string; bin: string; water: string;
  };
  /** the line under the console's upstream heading */
  upstreamKicker: string;
}

export function sheet(): Sheet {
  const source = ORE.source;
  const separation = ORE.separation;
  const dewater = DESIGN.dewater;
  const filter = DESIGN.filter;
  const grinds = source === 'mill' || source === 'scoop';

  const feed = source === 'collector'
    ? { label: 'Collector advance', unit: 't/h', hint: 'Nodules and sediment together. More '
      + 'tonnes is more nodules up the riser - and more sediment than the plant '
      + 'can take, which the cyclones bypass straight back out.' }
    : source === 'reclaim'
    ? { label: 'Dredge rate', unit: 't/h', hint: 'How hard the dredge works the old dam. '
      + 'These tailings were ground a century ago; the size is what it is.' }
    : source === 'scoop'
    ? { label: 'Scoop rate', unit: 't/h', hint: 'Fixed crusher power over more tonnes is a '
      + 'coarser product - and worn hammers make it coarser still.' }
    : separation === 'magnetic'
    ? { label: 'Mill feed', unit: 't/h ore', hint: 'Fixed power over more tonnes is a coarser '
      + 'grind. Past about 140 µm the metal is still locked in the silicate, and the '
      + 'drum cannot pull it.' }
    : { label: 'Mill feed', unit: 't/h ore', hint: 'Fixed power over more tonnes is a coarser '
      + 'grind. Coarse tailings filter faster and pump easier - but past about 140 µm '
      + 'the sulphides are not liberated and will not float.' };

  const floc = dewater === 'spinring'
    ? { label: 'Polymer dose', hint: 'Buys settling flux and underflow density, on top of '
      + 'what the ring\'s speed buys. Costs $' + DESIGN.costFloc.toLocaleString() + '/t.' }
    : dewater === 'magstack'
    ? { label: 'Seeded floc dose', hint: 'Flocculant carrying the magnetite the coils pull on. '
      + 'Costs $' + DESIGN.costFloc.toLocaleString() + '/t, with the seed it loses.' }
    : { label: 'Flocculant dose', hint: 'Buys settling flux and underflow density. '
      + 'Costs $' + DESIGN.costFloc.toLocaleString() + '/t.' };

  const uf = dewater === 'cyclones'
    ? { label: 'Cyclone underflow', hint: 'Tighter spigots make a denser underflow and '
      + 'send more fines out of the top. Out of the top is the sea. Tops out at 60%.' }
    : dewater === 'spinring'
    ? { label: 'Ring underflow', hint: 'Capped by polymer and by the ring\'s gravity. Push '
      + 'it and a dense, uneven bed sets the ring wobbling.' }
    : dewater === 'magstack'
    ? { label: 'Stack underflow', hint: 'Capped by seeded floc and field. A denser feed '
      + 'squeezes to a drier cake on the e-press.' }
    : { label: 'U/F density target', hint: 'Capped by flocculant. Push it and the rake '
      + 'torque climbs.' };

  const torque = dewater === 'spinring' ? { label: 'Ring imbalance', short: 'RING IMBALANCE' }
    : dewater === 'magstack' ? { label: 'Coil temperature', short: 'COIL TEMP' }
    : { label: 'Rake torque', short: 'RAKE TORQUE' };

  return {
    source, separation, dewater, filter,
    hasFrother: separation === 'flotation',
    hasDeslime: !!ORE.deslimeCircuit,
    hasFloc: bedded(dewater),
    hasUf: dewater !== 'dry',
    hasPress: filter !== 'none',
    hasSurge: dewater !== 'dry',
    hasBed: bedded(dewater),
    hasMedia: grinds,
    hasTorque: bedded(dewater),
    hasPlume: dewater === 'cyclones' || filter === 'deeppress',
    canSpillWater: dewater !== 'dry' && DESIGN.millReturnCap < 1e5,
    hasSulphide: separation === 'flotation' || ORE.nativeSulphide > 0.5,

    feed, floc, uf, torque,
    media: source === 'scoop'
      ? { button: 'Hammers', short: 'Hammer store' }
      : { button: 'Balls', short: 'Ball hopper' },
    binders: DESIGN.binders,
    frontButton: source === 'collector' ? 'Collector'
      : source === 'reclaim' ? 'Old dam'
      : source === 'scoop' ? 'Piles' : 'Mill',
    tiles: {
      source: source === 'collector' ? 'SEABED COLLECTOR'
        : source === 'reclaim' ? 'DAM DREDGE'
        : source === 'scoop' ? 'LOADERS + CRUSHER' : 'BALL MILL',
      separation: separation === 'magnetic' ? 'MAGNETIC DRUM'
        : separation === 'nodules' ? 'NODULE SCREEN'
        : separation === 'scrap' ? 'SCRAP MAGNET' : 'FLOTATION',
      deslime: 'DESLIME CYCLONES',
      dewater: {
        thickener: 'THICKENER 01', cyclones: 'DEWATERING CYCLONES',
        spinring: 'SPIN-RING THICKENER', magstack: 'MAGNETIC STACK', dry: '',
      }[dewater],
      filter: {
        press: 'PLATE PRESS', deeppress: 'DEEP-SEA FILTER', microwave: 'MICROWAVE DRIER',
        eopress: 'ELECTRO-OSMOTIC PRESS', none: '',
      }[filter],
      bin: dewater === 'dry' ? 'CRUSHED WASTE BIN' : 'CAKE BIN',
      water: dewater === 'dry' ? 'WATER STORE'
        : DESIGN.millReturnCap >= 1e5 && source === 'collector' ? 'SEAWATER RETURN'
        : 'PROCESS WATER',
    },
    upstreamKicker: source === 'collector' ? 'collector &middot; nodules &middot; cyclones'
      : source === 'reclaim' ? 'old dam &middot; dredge &middot; cyclones'
      : source === 'scoop' ? 'piles &middot; loaders &middot; crusher'
      : separation === 'magnetic' ? 'pit &middot; mill &middot; magnetic drum'
      : 'mill &middot; flotation &middot; cyclones',
  };
}
