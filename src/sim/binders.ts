/**
 * What holds the fill together.
 *
 * Today that is ground-up limestone fired in a kiln - portland cement - or a
 * slag blend when the tailings carry enough sulphur to eat it. Every world
 * offers two binders and a switch between them, and in the future worlds
 * neither of them is portland: it is either made out of what is to hand, or
 * shipped at a price nobody would pay for a bag of cement.
 *
 * A binder is a handful of numbers on the same strength model,
 *
 *   UCS = strength . k . Bd^1.4 . exp(c . density . (Cw - 0.76)) . sulphate . cure
 *
 * so each one is the same physics with a different personality: one leans
 * harder on a dense paste, one shrugs off the cold, one is eaten by pyrite.
 * The constants are invented. The trade-offs are the point.
 */

export type BinderType =
  | 'opc' | 'slag'            // today, and whatever is left of it in 2805
  | 'seamag'                  // magnesia out of seawater, on the abyssal plain
  | 'geopoly' | 'ferro'       // Psyche: nothing there was ever limestone
  | 'biocem' | 'magcarb';     // Meridian: grown, or cured with the city's CO2

export interface BinderSpec {
  id: BinderType;
  /** "Ordinary portland" - the inspector and the notes */
  name: string;
  /** "OPC" - the switch on the console */
  short: string;
  /** $/t, delivered or made on site */
  price: number;
  /** 28 d strength per unit dose, relative to portland in the same paste */
  strength: number;
  /** fraction of the strength lost per % sulphur in the tailings */
  sulphate: number;
  /** how hard strength leans on paste density: 1 is portland, 2 twice as steep */
  density: number;
  /** yield stress multiplier - how sticky it makes the paste */
  stiffness: number;
  /** share of the cold-cure penalty it shrugs off, 0 to 1 */
  cold: number;
  /** why you would pick it */
  hint: string;
}

const base = {
  strength: 1, sulphate: 0.30, density: 1, stiffness: 1, cold: 0,
};

/** Portland and a slag blend at a site's own cement price. */
export function portland(price: number): [BinderSpec, BinderSpec] {
  return [
    {
      ...base, id: 'opc', name: 'Ordinary portland', short: 'OPC', price,
      hint: 'Ground limestone and clay, fired in a kiln. Cheap, and sulphate eats it.',
    },
    {
      ...base, id: 'slag', name: 'Slag blend', short: 'slag blend',
      price: (price * 175) / 148, sulphate: 0.07,
      hint: 'Portland cut with blast-furnace slag. Costs more; shrugs off sulphides.',
    },
  ];
}

/**
 * Station Nereid. Portland comes down from the ship in pods. Sea-magnesia is
 * made on the bottom: electrolysis at the hull precipitates Mg(OH)2 out of the
 * seawater, and a magnesium-silicate binder made from it cures far better in
 * the 2 degC dark than a cement designed for a building site.
 */
export const NEREID_BINDERS: [BinderSpec, BinderSpec] = [
  {
    ...base, id: 'opc', name: 'Portland from the ship', short: 'portland', price: 148,
    hint: 'The surface binder, lowered in pods. At 2 °C it only gets two thirds of '
      + 'the way to its lab strength.',
  },
  {
    ...base, id: 'seamag', name: 'Sea-magnesia', short: 'sea-magnesia', price: 172,
    strength: 0.95, sulphate: 0.1, cold: 0.6,
    hint: 'Magnesia precipitated out of the seawater at the hull. Dearer, a little '
      + 'weaker in the lab - and it hardly minds the cold.',
  },
];

/**
 * Mass Driver One. There has never been a limestone on Psyche. A geopolymer
 * is the silicate waste itself, activated with an alkali that has to come up
 * a gravity well. Ferro-carbonate grows iron carbonate out of the metal fines
 * the drums miss and the CO2 the habitat breathes out - cheap, and weak
 * unless the paste is dense, because the carbonate has to bridge grain to
 * grain.
 */
export const PSYCHE_BINDERS: [BinderSpec, BinderSpec] = [
  {
    ...base, id: 'geopoly', name: 'Geopolymer', short: 'geopolymer', price: 1750,
    strength: 1.2, sulphate: 0, stiffness: 1.1,
    hint: 'The waste silicate, activated with an alkali shipped up from Earth. '
      + 'Strong and forgiving of a wet paste. The activator is the bill.',
  },
  {
    ...base, id: 'ferro', name: 'Ferro-carbonate', short: 'ferro-carbonate', price: 1250,
    strength: 0.5, sulphate: 0, density: 2.8, stiffness: 0.9,
    hint: 'Iron carbonate grown from the fines the drums miss and the habitat\'s '
      + 'CO2. Cheap. Only strong in a dense paste - dry the cake hard for it.',
  },
];

/**
 * Meridian. Bio-cement is an engineered bacterium fed urea and calcium, which
 * grows calcite between the grains - and the pyrite's acid dissolves calcite
 * the way it attacks portland. Carbon-cured magnesia is reactive MgO set with
 * CO2 pulled out of the towers' air handlers: dearer, strong, and indifferent
 * to sulphate.
 */
export const MERIDIAN_BINDERS: [BinderSpec, BinderSpec] = [
  {
    ...base, id: 'biocem', name: 'Bio-cement', short: 'bio-cement', price: 168,
    strength: 1.02, sulphate: 0.30, stiffness: 0.92,
    hint: 'Engineered bacteria growing calcite between the grains. Cheap and easy '
      + 'to pump - and pyrite acid dissolves calcite.',
  },
  {
    ...base, id: 'magcarb', name: 'Carbon-cured magnesia', short: 'carbon magnesia', price: 262,
    strength: 1.12, sulphate: 0.04, stiffness: 1.05,
    hint: 'Reactive magnesia cured with CO2 caught off the towers. Dearer, stronger, '
      + 'and sulphate does not touch it.',
  },
];
