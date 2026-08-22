/**
 * Helpers purs de présentation du calendrier : grille mensuelle et formats
 * français via Intl (aucune librairie de dates).
 */
import { Weekday, dateKey, lastMonday, parseKey } from './custody';

/**
 * Semaines complètes (lundi → dimanche) couvrant le mois donné, en clés
 * `YYYY-MM-DD`. `month` est 0-indexé comme Date.
 */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cursor = lastMonday(first);
  const weeks: string[][] = [];
  while (cursor <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const DAY_LONG_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY_LONG_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

/** « janvier 2026 » */
export function monthLabel(year: number, month: number): string {
  return MONTH_FMT.format(new Date(year, month, 1));
}

/** « mercredi 7 janvier » */
export function dayLabel(key: string): string {
  return DAY_LONG_FMT.format(parseKey(key));
}

/** « 14:32 » depuis un timestamp ISO. */
export function timeLabel(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Jours de la semaine pour les listes déroulantes : valeur ISO (1 = lundi) et
 * libellé français. Dérivés d'une semaine de référence commençant le lundi
 * 5 janvier 2026, pour ne pas coder les noms en dur.
 */
export const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] = (
  [1, 2, 3, 4, 5, 6, 7] as Weekday[]
).map((value) => ({
  value,
  label: WEEKDAY_LONG_FMT.format(new Date(2026, 0, 4 + value)),
}));

/** « vendredi » depuis un jour ISO (1 = lundi). */
export function weekdayLabel(weekday: Weekday): string {
  return WEEKDAY_OPTIONS[weekday - 1].label;
}
