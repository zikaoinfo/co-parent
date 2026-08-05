import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { dayLabel } from '../../core/calendar';
import { FamilyConfig, ParentIndex, RotationType, dateKey, lastMonday, parseKey } from '../../core/custody';
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
  protected holidayZone: HolidayZone | '' = '';
  protected holidaySplit = false;
  protected firstHalfEvenYears: ParentIndex = 0;
  protected readonly saving = signal(false);
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

  protected async create(): Promise<void> {
    const children = this.children()
      .map((c) => c.trim())
      .filter(Boolean);
    if (!this.parent0.trim() || !this.parent1.trim() || children.length === 0) {
      this.errorMessage.set('Renseignez les deux prénoms et au moins un enfant.');
      return;
    }
    const config: FamilyConfig = {
      parents: [this.parent0.trim(), this.parent1.trim()],
      children,
      rotation: {
        type: this.rotationType,
        anchor: this.normalizedAnchor(),
        start: this.startParent,
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
