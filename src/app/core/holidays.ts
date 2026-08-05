/**
 * Vacances scolaires françaises (métropole), zones A/B/C.
 *
 * Données statiques embarquées volontairement (pas d'appel à un service
 * tiers : contrainte du projet + fonctionnement offline). Périodes en jours
 * de vacances inclusifs : `start` = premier jour sans classe (samedi),
 * `end` = dernier jour avant la reprise (dimanche).
 *
 * ⚠ À compléter chaque année depuis education.gouv.fr (« calendrier
 * scolaire »). Sources : arrêtés publiés au Journal officiel —
 * 2025-2026 et 2026-2027 (JO des 22-23 octobre 2025).
 */

export type HolidayZone = 'A' | 'B' | 'C';

export interface HolidayPeriod {
  name: string;
  /** '*' = toutes zones. */
  zones: HolidayZone[] | '*';
  start: string; // YYYY-MM-DD inclus
  end: string; // YYYY-MM-DD inclus
}

export const SCHOOL_HOLIDAYS_FR: HolidayPeriod[] = [
  // ——— Année scolaire 2025-2026 ———
  { name: 'Vacances de la Toussaint', zones: '*', start: '2025-10-18', end: '2025-11-02' },
  { name: 'Vacances de Noël', zones: '*', start: '2025-12-20', end: '2026-01-04' },
  { name: "Vacances d'hiver", zones: ['A'], start: '2026-02-07', end: '2026-02-22' },
  { name: "Vacances d'hiver", zones: ['B'], start: '2026-02-14', end: '2026-03-01' },
  { name: "Vacances d'hiver", zones: ['C'], start: '2026-02-21', end: '2026-03-08' },
  { name: 'Vacances de printemps', zones: ['A'], start: '2026-04-04', end: '2026-04-19' },
  { name: 'Vacances de printemps', zones: ['B'], start: '2026-04-11', end: '2026-04-26' },
  { name: 'Vacances de printemps', zones: ['C'], start: '2026-04-18', end: '2026-05-03' },
  { name: "Vacances d'été", zones: '*', start: '2026-07-04', end: '2026-08-31' },

  // ——— Année scolaire 2026-2027 ———
  { name: 'Vacances de la Toussaint', zones: '*', start: '2026-10-17', end: '2026-11-01' },
  { name: 'Vacances de Noël', zones: '*', start: '2026-12-19', end: '2027-01-03' },
  { name: "Vacances d'hiver", zones: ['C'], start: '2027-02-06', end: '2027-02-21' },
  { name: "Vacances d'hiver", zones: ['A'], start: '2027-02-13', end: '2027-02-28' },
  { name: "Vacances d'hiver", zones: ['B'], start: '2027-02-20', end: '2027-03-07' },
  { name: 'Vacances de printemps', zones: ['C'], start: '2027-04-03', end: '2027-04-18' },
  { name: 'Vacances de printemps', zones: ['A'], start: '2027-04-10', end: '2027-04-25' },
  { name: 'Vacances de printemps', zones: ['B'], start: '2027-04-17', end: '2027-05-02' },
  { name: "Vacances d'été", zones: '*', start: '2027-07-03', end: '2027-08-31' },
];

/** Période de vacances couvrant le jour `key` pour la zone donnée, sinon null. */
export function holidayFor(key: string, zone: HolidayZone): HolidayPeriod | null {
  for (const period of SCHOOL_HOLIDAYS_FR) {
    if (period.zones !== '*' && !period.zones.includes(zone)) continue;
    if (key >= period.start && key <= period.end) return period;
  }
  return null;
}
