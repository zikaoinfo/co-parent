/**
 * Cœur métier pur du calendrier de garde.
 *
 * Toutes les dates sont manipulées en heure locale, sous forme de clés
 * `YYYY-MM-DD`. Jamais d'UTC pour les jours de garde : `toISOString()` sur une
 * date locale décale le jour autour de minuit. La semaine commence le lundi.
 */

import { HolidayZone, holidayFor } from './holidays';

export type ParentIndex = 0 | 1;
export type RotationType = 'week' | 'weekParity' | '223' | 'manual';

/** Prise en compte des vacances scolaires françaises. */
export interface HolidaysConfig {
  zone: HolidayZone;
  /** Partage moitié-moitié des périodes de vacances (prime sur la rotation). */
  split: boolean;
  /** Parent qui a la première moitié les années paires (alternance annuelle). */
  firstHalfEvenYears: ParentIndex;
}

/** Jour de la semaine, convention ISO : 1 = lundi … 7 = dimanche. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Qui vient chercher l'enfant lors d'une passation : un parent fixe, ou
 * `'custodian'` = celui qui prend la garde ce jour-là (il vient chercher).
 */
export type HandoverPickup = ParentIndex | 'custodian';

/** Passation récurrente : chaque semaine, ce jour-là, à cette heure. */
export interface Handover {
  weekday: Weekday;
  /** Heure locale, format `HH:MM`. */
  time: string;
  pickup: HandoverPickup;
}

export interface FamilyConfig {
  parents: [string, string];
  children: string[];
  rotation: {
    type: RotationType;
    /** 'YYYY-MM-DD', un lundi de référence. */
    anchor: string;
    /** Parent qui a la garde la semaine ancre. */
    start: ParentIndex;
    /**
     * Type 'weekParity' : parent qui a les semaines ISO paires
     * (les années ISO paires si `alternateYearly`).
     */
    evenWeeksParent?: ParentIndex;
    /** Type 'weekParity' : inverse l'attribution les années ISO impaires. */
    alternateYearly?: boolean;
  };
  /** Absent = vacances non affichées, rotation inchangée. */
  holidays?: HolidaysConfig;
  /** Passations récurrentes (jour, heure, parent qui vient chercher). */
  handovers?: Handover[];
  /** E-mail à l'autre parent à chaque modification (défaut : activé). */
  notifyByEmail?: boolean;
}

/** Échanges ponctuels : clé jour -> parent gardien ce jour-là. */
export type CustodyOverrides = Record<string, ParentIndex>;

/** Gardien d'un jour : 0 ou 1, ou -1 si non attribué (rotation manuelle sans échange). */
export type Custodian = ParentIndex | -1;

/**
 * Pattern 2-2-3 sur 14 jours, démarrant un lundi :
 * lun-mar P0, mer-jeu P1, ven-sam-dim P0, puis inversé la semaine suivante.
 */
const PATTERN_223: readonly ParentIndex[] = [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1];

/** Clé `YYYY-MM-DD` d'une date, en heure locale. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Date locale (minuit) depuis une clé `YYYY-MM-DD`. */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Lundi (minuit local) de la semaine contenant `date`. */
export function lastMonday(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (monday.getDay() + 6) % 7; // lun=0 … dim=6
  monday.setDate(monday.getDate() - shift);
  return monday;
}

/**
 * Nombre de jours entre deux clés (`to` − `from`), négatif si `to` est avant.
 * Calculé via Date.UTC pour être insensible aux changements d'heure (jours de
 * 23 h/25 h en heure locale).
 */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000;
}

/** Clé du jour situé `days` jours après `key` (négatif = avant). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

/** Minutes depuis minuit d'une heure `HH:MM`. */
export function minutesOfTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Numéro de semaine ISO 8601 (lundi premier jour, semaine 1 = celle du premier
 * jeudi) et année ISO correspondante — celle-ci peut différer de l'année civile
 * fin décembre / début janvier, ce qui garantit qu'une semaine n'est jamais
 * coupée en deux par un changement d'année.
 */
export function isoWeek(key: string): { week: number; year: number } {
  const [y, m, d] = key.split('-').map(Number);
  const thursday = new Date(Date.UTC(y, m - 1, d));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { week, year };
}

/**
 * Parent gardien pendant les vacances si le partage moitié-moitié est actif
 * et que `key` tombe dans une période de vacances, sinon null.
 * Première moitié (jours arrondis au supérieur) au parent désigné pour la
 * parité de l'année de début de la période, seconde moitié à l'autre.
 */
export function holidayCustodian(key: string, config: FamilyConfig): ParentIndex | null {
  const holidays = config.holidays;
  if (!holidays?.split) return null;
  const period = holidayFor(key, holidays.zone);
  if (!period) return null;

  const totalDays = daysBetween(period.start, period.end) + 1;
  const inFirstHalf = daysBetween(period.start, key) < Math.ceil(totalDays / 2);
  const startYear = Number(period.start.slice(0, 4));
  const firstHalfParent =
    startYear % 2 === 0
      ? holidays.firstHalfEvenYears
      : ((1 - holidays.firstHalfEvenYears) as ParentIndex);
  return inFirstHalf ? firstHalfParent : ((1 - firstHalfParent) as ParentIndex);
}

/**
 * Passation qui ouvre le cycle de garde : la première de la semaine (jour puis
 * heure). C'est elle qui décide du jour où la rotation bascule — configurer une
 * passation le vendredi fait courir la semaine de garde du vendredi au vendredi,
 * week-end compris. `null` si aucune passation n'est configurée.
 */
export function cycleHandover(handovers: readonly Handover[] | undefined): Handover | null {
  const sorted = [...(handovers ?? [])].sort(
    (a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time),
  );
  return sorted[0] ?? null;
}

/** Décalage du début de cycle, en jours depuis le lundi (0 sans passation). */
function cycleShiftDays(config: FamilyConfig): number {
  return (cycleHandover(config.handovers)?.weekday ?? 1) - 1;
}

/**
 * Gardien du jour `key` — précisément : celui chez qui l'enfant passe la nuit,
 * donc le gardien après la passation du jour s'il y en a une (`daySplit` donne
 * le détail intra-journalier). Priorité : échange ponctuel > partage des
 * vacances scolaires > rotation.
 */
export function custodianFor(
  key: string,
  config: FamilyConfig,
  overrides: CustodyOverrides = {},
): Custodian {
  const override = overrides[key];
  if (override !== undefined) return override;

  const fromHolidays = holidayCustodian(key, config);
  if (fromHolidays !== null) return fromHolidays;

  const { type, anchor, start } = config.rotation;
  if (type === 'manual') return -1;

  // Les rythmes hebdomadaires basculent à la passation, pas le lundi à minuit :
  // on ramène le jour au cycle qui le contient. Le 2-2-3 porte ses propres
  // transitions dans son pattern, il n'est pas décalé.
  const shift = type === '223' ? 0 : cycleShiftDays(config);

  if (type === 'weekParity') {
    // Une année ISO à 53 semaines donne deux semaines impaires consécutives
    // (53 puis 1) : c'est inhérent au rythme « semaines paires / impaires ».
    const { week, year } = isoWeek(shift ? addDays(key, -shift) : key);
    let evenParent = config.rotation.evenWeeksParent ?? 0;
    if (config.rotation.alternateYearly && year % 2 !== 0) {
      evenParent = (1 - evenParent) as ParentIndex;
    }
    return week % 2 === 0 ? evenParent : ((1 - evenParent) as ParentIndex);
  }

  const diff = daysBetween(anchor, key) - shift;
  if (type === 'week') {
    return ((((start + Math.floor(diff / 7)) % 2) + 2) % 2) as ParentIndex;
  }
  // type === '223'
  const index = ((diff % 14) + 14) % 14;
  const base = PATTERN_223[index];
  return start === 1 ? ((1 - base) as ParentIndex) : base;
}

/** Jour de la semaine d'une clé, convention ISO : 1 = lundi … 7 = dimanche. */
export function weekdayOf(key: string): Weekday {
  return (((parseKey(key).getDay() + 6) % 7) + 1) as Weekday;
}

/** Vrai si `time` est une heure locale valide au format `HH:MM`. */
export function isValidTime(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

/**
 * Passations programmées le jour `key`, triées par heure croissante.
 * Tableau vide si aucune passation n'est configurée ce jour-là.
 */
export function handoversFor(key: string, config: FamilyConfig): Handover[] {
  const weekday = weekdayOf(key);
  return (config.handovers ?? [])
    .filter((h) => h.weekday === weekday)
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Parent qui vient chercher l'enfant lors de cette passation. `'custodian'`
 * est résolu en gardien du jour (échanges et vacances compris) : c'est lui qui
 * prend l'enfant. Peut valoir -1 en rotation manuelle sans jour attribué.
 */
export function handoverPickup(
  handover: Handover,
  key: string,
  config: FamilyConfig,
  overrides: CustodyOverrides = {},
): Custodian {
  return handover.pickup === 'custodian' ? custodianFor(key, config, overrides) : handover.pickup;
}

/** Journée coupée en deux par une passation : qui avant, qui après, à quelle heure. */
export interface DaySplit {
  /** Gardien du début de journée (celui de la veille). */
  before: Custodian;
  /** Gardien de la fin de journée et de la nuit (= `custodianFor`). */
  after: Custodian;
  /** Minutes depuis minuit ; 0 = bascule à minuit, aucune passation configurée. */
  atMinutes: number;
  /** Heure `HH:MM` de la passation, `null` si la bascule se fait à minuit. */
  time: string | null;
}

/**
 * Partage du jour `key` quand l'enfant change de maison ce jour-là, sinon
 * `null`. Le changement est constaté sur l'attribution (rotation, échange
 * ponctuel ou partage des vacances) ; l'heure vient de la passation configurée
 * ce jour de la semaine — à défaut, la bascule est réputée se faire à minuit et
 * la journée reste d'une seule couleur.
 */
export function daySplit(
  key: string,
  config: FamilyConfig,
  overrides: CustodyOverrides = {},
): DaySplit | null {
  const after = custodianFor(key, config, overrides);
  const before = custodianFor(addDays(key, -1), config, overrides);
  if (before === after) return null;
  const handover = handoversFor(key, config)[0] ?? null;
  return {
    before,
    after,
    atMinutes: handover ? minutesOfTime(handover.time) : 0,
    time: handover?.time ?? null,
  };
}
