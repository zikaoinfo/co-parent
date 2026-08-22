import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WEEKDAY_INITIALS, monthGrid, monthLabel } from '../../core/calendar';
import { Custodian, custodianFor, dateKey, handoversFor } from '../../core/custody';
import { holidayFor } from '../../core/holidays';
import { FamilyStore } from '../../core/family.store';
import { DayPanel } from './day-panel';

interface DayCell {
  key: string;
  dayNumber: number;
  inMonth: boolean;
  custodian: Custodian;
  isToday: boolean;
  swapped: boolean;
  hasEvents: boolean;
  hasNote: boolean;
  handover: boolean; // gardien différent du jour précédent -> trait de passation
  pickupTime: string | null; // heure de la passation programmée dans les réglages
  holiday: boolean; // vacances scolaires (zone de la famille)
}

@Component({
  selector: 'app-calendar',
  imports: [RouterLink, DayPanel],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class CalendarPage {
  protected readonly store = inject(FamilyStore);

  private readonly today = dateKey(new Date());
  protected readonly viewYear = signal(new Date().getFullYear());
  protected readonly viewMonth = signal(new Date().getMonth());
  protected readonly selectedDay = signal<string | null>(null);

  protected readonly weekdays = WEEKDAY_INITIALS;

  protected readonly title = computed(() => monthLabel(this.viewYear(), this.viewMonth()));

  protected readonly weeks = computed<DayCell[][]>(() => {
    const config = this.store.config();
    if (!config) return [];
    const overrides = this.store.overrideIndex();
    const eventsByDay = this.store.eventsByDay();
    const notes = this.store.notes();
    const month = this.viewMonth();
    const zone = config.holidays?.zone;
    let previous: Custodian | null = null;
    return monthGrid(this.viewYear(), month).map((week) =>
      week.map((key) => {
        const custodian = custodianFor(key, config, overrides);
        const cell: DayCell = {
          key,
          dayNumber: Number(key.slice(8)),
          inMonth: Number(key.slice(5, 7)) - 1 === month,
          custodian,
          isToday: key === this.today,
          swapped: key in overrides,
          hasEvents: (eventsByDay[key]?.length ?? 0) > 0,
          hasNote: key in notes,
          handover: previous !== null && previous !== custodian,
          pickupTime: handoversFor(key, config)[0]?.time ?? null,
          holiday: zone ? holidayFor(key, zone) !== null : false,
        };
        previous = custodian;
        return cell;
      }),
    );
  });

  /** Des passations sont-elles programmées (pour la légende) ? */
  protected readonly hasHandovers = computed(
    () => (this.store.config()?.handovers?.length ?? 0) > 0,
  );

  /** Zone de vacances configurée (pour la légende). */
  protected readonly holidayZone = computed(() => this.store.config()?.holidays?.zone ?? null);

  protected previousMonth(): void {
    const m = this.viewMonth() - 1;
    if (m < 0) {
      this.viewMonth.set(11);
      this.viewYear.update((y) => y - 1);
    } else {
      this.viewMonth.set(m);
    }
  }

  protected nextMonth(): void {
    const m = this.viewMonth() + 1;
    if (m > 11) {
      this.viewMonth.set(0);
      this.viewYear.update((y) => y + 1);
    } else {
      this.viewMonth.set(m);
    }
  }

  protected goToday(): void {
    const now = new Date();
    this.viewYear.set(now.getFullYear());
    this.viewMonth.set(now.getMonth());
    this.selectedDay.set(this.today);
  }

  protected select(key: string): void {
    this.selectedDay.set(this.selectedDay() === key ? null : key);
  }
}
