/**
 * What this site's flowsheet actually has in it, in the words the consoles
 * should use.
 *
 * Read once the scenario has been applied. The side console, the SCADA and
 * the inspector all ask this rather than each deciding for themselves which
 * sliders, tiles and lamps exist - so a frother slider cannot turn up on a
 * plant with no flotation bank, or a rake torque on one with no rakes.
 */
import { DESIGN } from '../sim/plant';
import { ORE } from '../sim/upstream';

export interface Sheet {
  source: typeof ORE.source;
  separation: typeof ORE.separation;
  dewater: typeof DESIGN.dewater;

  hasFrother: boolean;
  hasDeslime: boolean;
  /** flocculant, or polymer on a centrifuge */
  hasFloc: boolean;
  /** an underflow density setpoint */
  hasUf: boolean;
  hasPress: boolean;
  hasSurge: boolean;
  hasThickener: boolean;
  /** a consumable the grinder eats - balls or hammers */
  hasMedia: boolean;
  /** a torque worth watching - rakes, or a decanter scroll */
  hasTorque: boolean;
  /** fines leave with an overflow and are billed */
  hasPlume: boolean;
  /** the process water tank can overflow */
  canSpillWater: boolean;
  /** sulphides can reach the binder */
  hasSulphide: boolean;

  feed: { label: string; unit: string; hint: string };
  floc: { label: string; hint: string };
  uf: { label: string; hint: string };
  media: { button: string; short: string };
  /** the view button for the front end: Mill, Collector, Old dam, Piles */
  frontButton: string;
  tiles: {
    source: string; separation: string; deslime: string; dewater: string;
    bin: string; water: string;
  };
  /** the line under the console's upstream heading */
  upstreamKicker: string;
}

export function sheet(): Sheet {
  const source = ORE.source;
  const separation = ORE.separation;
  const dewater = DESIGN.dewater;
  const hasThickener = dewater === 'thickener';
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

  return {
    source, separation, dewater,
    hasFrother: separation === 'flotation',
    hasDeslime: !!ORE.deslimeCircuit,
    hasFloc: dewater === 'thickener' || dewater === 'centrifuge',
    hasUf: dewater !== 'dry',
    hasPress: dewater !== 'dry',
    hasSurge: dewater !== 'dry',
    hasThickener,
    hasMedia: grinds,
    hasTorque: dewater === 'thickener' || dewater === 'centrifuge',
    hasPlume: dewater === 'cyclones' || dewater === 'centrifuge',
    canSpillWater: dewater !== 'dry' && DESIGN.millReturnCap < 1e5,
    hasSulphide: separation === 'flotation' || ORE.nativeSulphide > 0.5,

    feed,
    floc: dewater === 'centrifuge'
      ? { label: 'Polymer dose', hint: 'Buys cake solids and a clean centrate. There is '
        + 'no settling to buy at 0.015 g - the bowl does that.' }
      : { label: 'Flocculant dose', hint: 'Buys settling flux and underflow density. '
        + 'Costs $' + DESIGN.costFloc.toLocaleString() + '/t.' },
    uf: dewater === 'cyclones'
      ? { label: 'Cyclone underflow', hint: 'Tighter spigots make a denser underflow and '
        + 'send more fines out of the top. Out of the top is the sea. Tops out at 60%.' }
      : dewater === 'centrifuge'
      ? { label: 'Decanter cake solids', hint: 'Capped by polymer. Push it and the scroll '
        + 'torque climbs.' }
      : { label: 'U/F density target', hint: 'Capped by flocculant. Push it and the rake '
        + 'torque climbs.' },
    media: source === 'scoop'
      ? { button: 'Hammers', short: 'Hammer store' }
      : { button: 'Balls', short: 'Ball hopper' },
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
      dewater: dewater === 'cyclones' ? 'DEWATERING CYCLONES'
        : dewater === 'centrifuge' ? 'DECANTER CENTRIFUGE' : 'THICKENER 01',
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
