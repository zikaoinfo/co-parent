/**
 * Cœur métier pur du calendrier de garde.
 *
 * Toutes les dates sont manipulées en heure locale, sous forme de clés
 * `YYYY-MM-DD`. Jamais d'UTC pour les jours de garde : `toISOString()` sur une
 * date locale décale le jour autour de minuit. La semaine commence le lundi.
 */

export type ParentIndex = 0 | 1;
export type RotationType = 'week' | '223' | 'manual';

export interface FamilyConfig {
  parents: [string, string];
  children: string[];
  rotation: {
    type: RotationType;
    /** 'YYYY-MM-DD', un lundi de référence. */
    anchor: string;
    /** Parent qui a la garde la semaine ancre. */
    start: ParentIndex;
  };
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

/** Gardien du jour `key` selon la rotation et les échanges ponctuels. */
export function custodianFor(
  key: string,
  config: FamilyConfig,
  overrides: CustodyOverrides = {},
): Custodian {
  const override = overrides[key];
  if (override !== undefined) return override;

  const { type, anchor, start } = config.rotation;
  if (type === 'manual') return -1;

  const diff = daysBetween(anchor, key);
  if (type === 'week') {
    return ((((start + Math.floor(diff / 7)) % 2) + 2) % 2) as ParentIndex;
  }
  // type === '223'
  const index = ((diff % 14) + 14) % 14;
  const base = PATTERN_223[index];
  return start === 1 ? ((1 - base) as ParentIndex) : base;
}
