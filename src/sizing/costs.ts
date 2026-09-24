import { krebsCapacity } from '@jacob12244/proc-engine';
import { PRESS_PRESSURE, S, cycloneDiameter, type Contract, type Design } from './circuit';
import { CONES, JAWS, PASTE_PUMPS, PIPES, PRESS_PLATES, RAKE_DRIVES, SCREENS } from './equipment';
import { pumpDuty } from './backfill';
import type { Summary } from './summary';
import type { StationId } from './site';

/**
 * What the plant costs to build and to run: an early estimate, the kind
 * that ranks designs rather than funds one.
 *
 * Capital is installed cost as the US Bureau of Mines defines it (equipment,
 * installation and the circuit's own steel, piping and electrics; no buildings,
 * EPCM or working capital), from its public-domain cost estimating system:
 *
 *   USBM IC 9143 (1987), Bureau of Mines Cost Estimating System Handbook,
 *   Part 2, Mineral Processing. January 1984 dollars, capacity X in t/d:
 *     crushing circuit   Yc = 2,392.492·X^0.775, times a hardness factor
 *                        0.995·(14.3/Wi)^-0.744 and a product-size factor
 *                        1.122·S^-0.714 (S the final setting, cm)
 *     grinding circuit   Yc = 4,457.437·X^0.806, times 0.117·Wi^0.806
 *   USBM IC 9170 (Stebbins 1987), January 1985 dollars:
 *     vibrating screen   Yc = 11,280·A^0.631 (A in m²)
 *
 * The circuit curves price a whole circuit; here each machine is priced on
 * its own rated capacity, so a machine bigger than its duty costs more, with
 * the circuit's cost split between the machines by the shares below. Those
 * shares are this game's assumption, not the Bureau's.
 *
 * Running cost is power at the US industrial average (EIA Electric Power
 * Monthly, table 5.6.A, June 2026: 9.17 ¢/kWh) and the steel the machines
 * wear away, by Bond's metal wear relations on the ore's abrasion index Ai:
 * wet ball mill balls 0.35·(Ai − 0.015)^0.33 and liners 0.026·(Ai − 0.015)^0.3,
 * crusher liners (Ai + 0.22)/11, all lb/kWh. Bond's ball wear runs high
 * against modern media (a copper mill measured 1.1 kg/t where Bond gives
 * 1.2 and later ran under 0.3), so read the media line as a ceiling.
 *
 * The paste plant, on the same basis:
 *   thickener         USBM IC 9143: Yc = 6,436·A^0.625 (A in m², January 1984
 *                     dollars), for a conventional tank. Deeper tanks and
 *                     heavier rake drives cost more of the equipment share
 *                     (2,568.866 of 5,465.673): scaled here by the tank's
 *                     steel area and the drive's torque factor, which is this
 *                     game's assumption.
 *   filter presses    USBM IC 9143: a pressure filter is 1.71 times a vacuum
 *                     filter, Yc = 28,375·A^0.65 (A in m²). The press feed
 *                     pumps' power is the pressure times the feed, at the
 *                     pump efficiency below.
 *   flocculant        at 20 g/t of tailings (plants report 12 to 25), at the
 *                     Bureau's $2.76/kg (IC 9143, January 1984 dollars).
 *   binder            the running cost that matters most: tonnes an hour at
 *                     the USGS average cement price (Mineral Commodity
 *                     Summaries 2026: $160/t for 2025). The mixer and binder
 *                     silo are not priced: there is no open curve for them.
 *   paste pumps       power is the pressure times the flow over the pump
 *                     efficiency. Capital for piston pumps and steel line has
 *                     no open cost curve; the figures below are this game's.
 *                     They land where the Bureau's whole slurry pipeline
 *                     curve does (IC 9143: 21,021.7·X^0.546 for pumps, tanks
 *                     and pipe), about $5M for 300 t/h over 3.5 km.
 */

export interface StationCost {
  capex: number;
  kW: number;
  opexPerT: number;
}

export interface Costs {
  stations: Record<StationId, StationCost>;
  capex: number;
  kW: number;
  opexPerT: number;
  opexPerYear: number;
}

/** Operating hours a year: 8,000 is 91% of the year. */
export const HOURS = 8000;
/** $/kWh, US industrial average, June 2026 (EIA). */
export const POWER_PRICE = 0.0917;
/**
 * Escalation from the Bureau's 1984-85 dollars: CEPCI 325 in 1985 (NETL) to
 * an assumed 800 for 2026, since the current index is not openly published.
 */
const ESCALATE = 800 / 325;
/** Steel prices, $/kg: forged balls, and manganese and alloy liners. Assumed. */
const BALL_PRICE = 1.3;
const LINER_PRICE = 3.0;
/** lb to kg. */
const LB = 0.4536;
/** Installed power of a vibrating screen's exciters, kW; an assumption. */
const SCREEN_KW = 30;

/** Binder price, $/t: USGS MCS 2026, cement, average mill unit value for 2025. */
const BINDER_PRICE = 160;
/** Flocculant, kg per tonne of tailings (assumed, within the 12 to 25 g/t plants report), and its price, $/kg, January 1984 (IC 9143). */
const FLOC_DOSE = 0.02;
const FLOC_PRICE_1984 = 2.76;
/** Paste pumps installed, $ per kW of installed motor; steel paste line, $ per metre per mm of bore. Assumed. */
const PASTE_PUMP_PER_KW = 3000;
const LINE_PER_M_PER_MM = 2.5;
/** Pump efficiency, motor included, for the press feed pumps. Assumed. */
const FEED_PUMP_EFFICIENCY = 0.7;

/** How each circuit's cost is shared between its machines: this game's assumption. */
const CRUSHING_SHARE = { jaw: 0.35, secondary: 0.25, tertiary: 0.25 };
const GRINDING_SHARE = { mill: 0.85, cyclones: 0.15 };

const pick = <T,>(list: T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, Math.round(i)))];
const r = (s: Summary, node: string, key: string) => s.results[node]?.[key] ?? Number.NaN;
const known = (v: number) => Number.isFinite(v) && v > 0;
/** kg/s to t/d. */
const TPD = 86.4;

/** The Bureau's crushing circuit, installed, at X t/d, today's dollars. */
function crushing(tpd: number, wi: number, settingCm: number): number {
  const hardness = 0.995 * Math.pow(14.3 / wi, -0.744);
  const product = 1.122 * Math.pow(Math.max(0.1, settingCm), -0.714);
  return 2392.492 * Math.pow(Math.max(1, tpd), 0.775) * hardness * product * ESCALATE;
}

/** The Bureau's grinding circuit, installed, at X t/d, today's dollars. */
function grinding(tpd: number, wi: number): number {
  return 4457.437 * Math.pow(Math.max(1, tpd), 0.806) * 0.117 * Math.pow(wi, 0.806) * ESCALATE;
}

/** Bond's specific energy, kWh/t, from F80 to P80 in metres. */
function bond(wi: number, f80: number, p80: number): number {
  return 10 * wi * (1 / Math.sqrt(p80 * 1e6) - 1 / Math.sqrt(f80 * 1e6));
}

export function costsFor(c: Contract, d: Design, s: Summary): Costs {
  const tph = c.tph;
  const plantTpd = tph * 24;
  const ai = c.ai;
  const crusherLiner = ((ai + 0.22) / 11) * LB; // kg/kWh
  const perT = (kW: number, wearPerH = 0) => (kW * POWER_PRICE + wearPerH) / tph;
  const setting = d.tertCss * 100;

  const jaw = pick(JAWS, d.jawModel);
  const sec = pick(CONES, d.secModel);
  const tert = pick(CONES, d.tertModel);
  const scr = pick(SCREENS, d.screenModel);

  // a crusher is priced on the tonnage it is rated for at its setting; its power is what Bond says it spends, up to its motor
  const rated = (node: string, fallback: number) => {
    const cap = r(s, node, 'capacity');
    return known(cap) ? cap * TPD : fallback;
  };
  const crusherKW = (node: string, installed: number) => {
    const bondW = r(s, node, 'power');
    return Math.min(installed, known(bondW) ? bondW / 1000 : installed * 0.7);
  };

  const jawKW = crusherKW('JAW', jaw.kW);
  const primary: StationCost = {
    capex: CRUSHING_SHARE.jaw * crushing(rated('JAW', plantTpd), c.wi, setting),
    kW: jawKW,
    opexPerT: perT(jawKW, jawKW * crusherLiner * LINER_PRICE),
  };

  const secKW = crusherKW('SEC', sec.kW);
  const secondary: StationCost = {
    capex: CRUSHING_SHARE.secondary * crushing(rated('SEC', plantTpd), c.wi, setting),
    kW: secKW,
    opexPerT: perT(secKW, secKW * crusherLiner * LINER_PRICE),
  };

  const screens = Math.round(d.screens);
  const tertKW = crusherKW('TERT', tert.kW);
  const screenArea = scr.width * scr.length;
  const tertiary: StationCost = {
    capex:
      CRUSHING_SHARE.tertiary * crushing(rated('TERT', plantTpd), c.wi, setting) +
      screens * 11_280 * Math.pow(screenArea, 0.631) * ESCALATE,
    kW: tertKW + SCREEN_KW * screens,
    opexPerT: perT(tertKW + SCREEN_KW * screens, tertKW * crusherLiner * LINER_PRICE),
  };

  // the mill is rated for the tonnage its power would grind from this feed to the contract's grind
  const draw = known(r(s, 'BM', 'powerDraw')) ? r(s, 'BM', 'powerDraw') / 1000 : 0;
  const f80 = s.streams[S.fineOre]?.p80 ?? 0.006;
  const specific = Math.max(1, bond(c.wi, f80, c.p80));
  const millTpd = draw > 0 ? (draw / specific) * 24 : plantTpd;
  const balls = 0.35 * Math.pow(Math.max(0, ai - 0.015), 0.33) * LB;
  const liners = 0.026 * Math.pow(Math.max(0, ai - 0.015), 0.3) * LB;
  const mill: StationCost = {
    capex: GRINDING_SHARE.mill * grinding(millTpd, c.wi),
    kW: draw,
    opexPerT: perT(draw, draw * (balls * BALL_PRICE + liners * LINER_PRICE)),
  };

  // the cluster is rated on what its cyclones pass at 70 kPa against the flow it is given;
  // the feed pump lifts the slurry to the tower and makes the pressure
  const n = Math.round(d.cyclones);
  const feed = s.streams[S.cycFeed];
  const q = feed ? feed.m3h / 3600 : 0;
  const clusterTpd = q > 0 ? plantTpd * ((n * krebsCapacity(cycloneDiameter(d), 70e3).flow) / q) : plantTpd;
  const pressure = known(r(s, 'CYC', 'pressure')) ? r(s, 'CYC', 'pressure') : 70e3;
  const rho = feed && feed.m3h > 0 ? (feed.tph / Math.max(1e-9, feed.cw) / feed.m3h) * 1000 : 1500;
  const pumpKW = (q * (pressure + rho * 9.81 * 18)) / 0.7 / 1000;
  const cyclones: StationCost = {
    capex: GRINDING_SHARE.cyclones * grinding(clusterTpd, c.wi),
    kW: pumpKW,
    opexPerT: perT(pumpKW),
  };

  // ---- paste thickener
  const area = (Math.PI * d.thDiam * d.thDiam) / 4;
  const equipmentShare = 2568.866 / 5465.673;
  const steel = (d.thDiam / 4 + d.thDepth) / (d.thDiam / 4 + 3.5);
  const drive = Math.pow(pick(RAKE_DRIVES, d.rakeDrive).k / 20, 0.25);
  const tailsTph = s.streams[S.tails]?.tph ?? 0;
  const thickener: StationCost = {
    capex: 6436 * Math.pow(area, 0.625) * ESCALATE * (1 - equipmentShare + equipmentShare * steel * drive),
    kW: 0,
    // kg/h of flocculant at its price, over the plant's tonnes an hour
    opexPerT: (tailsTph * FLOC_DOSE * FLOC_PRICE_1984 * ESCALATE) / tph,
  };

  // ---- filter presses: 1.71 times the Bureau's vacuum filter, by area; feed pumps at filtration pressure
  const pressArea = pick(PRESS_PLATES, d.pressPlate).chamberArea * Math.round(d.pressChambers) * Math.round(d.presses);
  const feedFlow = (s.streams[S.filterFeed]?.m3h ?? 0) / 3600;
  const feedKW = (PRESS_PRESSURE * feedFlow) / FEED_PUMP_EFFICIENCY / 1000;
  const filter: StationCost = {
    capex: 1.71 * 28375 * Math.pow(pressArea, 0.65) * ESCALATE,
    kW: feedKW,
    opexPerT: perT(feedKW),
  };

  // ---- paste: the binder
  const pasteSolids = s.streams[S.paste]?.tph ?? 0;
  const binderTph = pasteSolids * d.binder;
  const paste: StationCost = { capex: 0, kW: 0, opexPerT: (binderTph * BINDER_PRICE) / tph };

  // ---- paste pumps and line
  const pump = pick(PASTE_PUMPS, d.pumpModel);
  const pipe = pick(PIPES, d.pipeModel);
  const duty = pumpDuty(c, d, s);
  const pasteKW = Number.isFinite(duty.power) ? Math.max(0, duty.power) / 1000 : 0;
  const lineLength = c.backfill.surface + c.backfill.drop + c.backfill.level;
  const pumping: StationCost = {
    capex: Math.round(d.pumps) * pump.kW * PASTE_PUMP_PER_KW + lineLength * pipe.nb * LINE_PER_M_PER_MM,
    kW: pasteKW,
    opexPerT: perT(pasteKW),
  };

  const stations = { primary, secondary, tertiary, mill, cyclones, thickener, filter, paste, pumping };
  const all = Object.values(stations);
  const capex = all.reduce((a, b) => a + b.capex, 0);
  const kW = all.reduce((a, b) => a + b.kW, 0);
  const opexPerT = all.reduce((a, b) => a + b.opexPerT, 0);
  return { stations, capex, kW, opexPerT, opexPerYear: opexPerT * tph * HOURS };
}
