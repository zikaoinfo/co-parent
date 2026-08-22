import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WEEKDAY_OPTIONS, dayLabel, weekdayLabel } from '../../core/calendar';
import {
  FamilyConfig,
  Handover,
  ParentIndex,
  RotationType,
  dateKey,
  addDays,
  cycleHandover,
  isValidTime,
  isoWeek,
  lastMonday,
  parseKey,
} from '../../core/custody';

import { HolidayZone } from '../../core/holidays';
import { FamilyStore } from '../../core/family.store';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-setup',
  imports: [FormsModule, RouterLink],
  templateUrl: './setup.html',
  styleUrl: './setup.css',
})
export class SetupPage {
  protected readonly store = inject(FamilyStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected parent0 = '';
  protected parent1 = '';
  protected readonly children = signal<string[]>(['']);
  protected rotationType: RotationType = 'week';
  protected anchorInput = dateKey(lastMonday(new Date()));
  protected startParent: ParentIndex = 0;
  protected evenWeeksParent: ParentIndex = 0;
  protected alternateYearly = false;
  protected holidayZone: HolidayZone | '' = '';
  protected holidaySplit = false;
  protected firstHalfEvenYears: ParentIndex = 0;
  protected readonly handovers = signal<Handover[]>([]);
  protected readonly saving = signal(false);

  protected readonly weekdayOptions = WEEKDAY_OPTIONS;
  protected readonly errorMessage = signal<string | null>(null);

  /** L'ancre est toujours ramenée au lundi de la semaine choisie. */
  protected readonly anchorMonday = computed(() => this.normalizedAnchor());

  protected readonly inviteLink = computed(() => {
    const token = this.store.inviteToken();
    return token ? new URL(`join/${token}`, document.baseURI).href : null;
  });

  protected anchorMondayLabel(): string {
    return dayLabel(this.normalizedAnchor());
  }

  protected currentWeekHint(): string {
    const { week } = isoWeek(dateKey(new Date()));
    return `Nous sommes en semaine ${week} (${week % 2 === 0 ? 'paire' : 'impaire'}).`;
  }

  private normalizedAnchor(): string {
    return dateKey(lastMonday(parseKey(this.anchorInput || dateKey(new Date()))));
  }

  protected addChild(): void {
    this.children.update((list) => [...list, '']);
  }

  protected removeChild(index: number): void {
    this.children.update((list) => list.filter((_, i) => i !== index));
  }

  protected trackByIndex(index: number): number {
    return index;
  }

  protected updateChild(index: number, value: string): void {
    this.children.update((list) => list.map((c, i) => (i === index ? value : c)));
  }

  /** « vendredi 9 janvier » : premier jour du cycle de référence. */
  protected cycleStartDayLabel(): string | null {
    const handover = cycleHandover(this.handovers());
    if (!handover || this.rotationType === 'manual' || this.rotationType === '223') return null;
    return dayLabel(addDays(this.normalizedAnchor(), handover.weekday - 1));
  }

  /** « vendredi à 18:00 » : la passation qui fait basculer la rotation. */
  protected cycleStartLabel(): string | null {
    const handover = cycleHandover(this.handovers());
    return handover ? `${weekdayLabel(handover.weekday)} à ${handover.time}` : null;
  }

  protected addHandover(): void {
    this.handovers.update((list) => [...list, { weekday: 5, time: '18:00', pickup: 'custodian' }]);
  }

  protected removeHandover(index: number): void {
    this.handovers.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateHandover(index: number, patch: Partial<Handover>): void {
    this.handovers.update((list) => list.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }

  protected async create(): Promise<void> {
    const children = this.children()
      .map((c) => c.trim())
      .filter(Boolean);
    if (!this.parent0.trim() || !this.parent1.trim() || children.length === 0) {
      this.errorMessage.set('Renseignez les deux prénoms et au moins un enfant.');
      return;
    }
    const handovers = this.handovers();
    if (handovers.some((h) => !isValidTime(h.time))) {
      this.errorMessage.set("Renseignez l'heure de chaque passation.");
      return;
    }
    const config: FamilyConfig = {
      parents: [this.parent0.trim(), this.parent1.trim()],
      children,
      rotation: {
        type: this.rotationType,
        anchor: this.normalizedAnchor(),
        start: this.startParent,
        ...(this.rotationType === 'weekParity'
          ? { evenWeeksParent: this.evenWeeksParent, alternateYearly: this.alternateYearly }
          : {}),
      },
      ...(this.holidayZone
        ? {
            holidays: {
              zone: this.holidayZone,
              split: this.holidaySplit,
              firstHalfEvenYears: this.firstHalfEvenYears,
            },
          }
        : {}),
      ...(handovers.length ? { handovers } : {}),
      notifyByEmail: true,
    };
    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      await this.store.createFamily(config);
      this.toast.show('Famille créée !');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'La création a échoué.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async copyInviteLink(): Promise<void> {
    const link = this.inviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.toast.show('Lien copié !');
    } catch {
      this.toast.show('Copie impossible — sélectionnez le lien manuellement.');
    }
  }

  protected goToCalendar(): void {
    void this.router.navigateByUrl('/');
  }
}
