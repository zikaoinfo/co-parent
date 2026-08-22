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
import { BUILD_INFO } from '../../../environments/build-info';
import { AuthService } from '../../core/auth.service';
import { FamilyStore } from '../../core/family.store';
import { PushService } from '../../core/push.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage {
  protected readonly store = inject(FamilyStore);
  protected readonly auth = inject(AuthService);
  protected readonly push = inject(PushService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected parent0: string;
  protected parent1: string;
  protected readonly children = signal<string[]>([]);
  protected rotationType: RotationType;
  protected anchorInput: string;
  protected startParent: ParentIndex;
  protected evenWeeksParent: ParentIndex;
  protected alternateYearly: boolean;
  protected holidayZone: HolidayZone | '';
  protected holidaySplit: boolean;
  protected firstHalfEvenYears: ParentIndex;
  protected notifyByEmail: boolean;
  protected readonly handovers = signal<Handover[]>([]);
  protected readonly saving = signal(false);

  protected readonly weekdayOptions = WEEKDAY_OPTIONS;

  /** Version déployée : numéro de build, commit et date (voir scripts/build-info.mjs). */
  protected readonly buildInfo = BUILD_INFO;

  /** « 22 août 2026 », vide si la date du commit est indéterminée. */
  protected readonly buildDate = computed(() =>
    BUILD_INFO.date
      ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(BUILD_INFO.date))
      : '',
  );

  protected readonly inviteLink = computed(() => {
    const token = this.store.inviteToken();
    return token ? new URL(`join/${token}`, document.baseURI).href : null;
  });

  constructor() {
    const config = this.store.config();
    this.parent0 = config?.parents[0] ?? '';
    this.parent1 = config?.parents[1] ?? '';
    this.children.set(config?.children?.length ? [...config.children] : ['']);
    this.rotationType = config?.rotation.type ?? 'week';
    this.anchorInput = config?.rotation.anchor ?? dateKey(lastMonday(new Date()));
    this.startParent = config?.rotation.start ?? 0;
    this.evenWeeksParent = config?.rotation.evenWeeksParent ?? 0;
    this.alternateYearly = config?.rotation.alternateYearly ?? false;
    this.holidayZone = config?.holidays?.zone ?? '';
    this.holidaySplit = config?.holidays?.split ?? false;
    this.firstHalfEvenYears = config?.holidays?.firstHalfEvenYears ?? 0;
    this.notifyByEmail = config?.notifyByEmail ?? true;
    this.handovers.set((config?.handovers ?? []).map((h) => ({ ...h })));
  }

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

  protected async save(): Promise<void> {
    const children = this.children()
      .map((c) => c.trim())
      .filter(Boolean);
    if (!this.parent0.trim() || !this.parent1.trim() || children.length === 0) {
      this.toast.show('Renseignez les deux prénoms et au moins un enfant.');
      return;
    }
    const handovers = this.handovers();
    if (handovers.some((h) => !isValidTime(h.time))) {
      this.toast.show("Renseignez l'heure de chaque passation.");
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
      notifyByEmail: this.notifyByEmail,
    };
    this.saving.set(true);
    try {
      await this.store.updateConfig(config);
      this.toast.show('Réglages enregistrés');
      await this.router.navigateByUrl('/');
    } catch {
      this.toast.show("L'enregistrement a échoué, réessayez.");
    } finally {
      this.saving.set(false);
    }
  }

  protected async regenerateInvitation(): Promise<void> {
    try {
      await this.store.regenerateInvitation();
      this.toast.show('Nouveau lien généré');
    } catch (error) {
      this.toast.show(error instanceof Error ? error.message : 'La génération a échoué.');
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

  protected async togglePush(): Promise<void> {
    try {
      if (this.push.enabled()) {
        await this.push.disable();
        this.toast.show('Notifications désactivées sur cet appareil');
      } else {
        await this.push.enable();
        this.toast.show('Notifications activées sur cet appareil');
      }
    } catch {
      this.toast.show(
        this.push.denied()
          ? 'Permission refusée — autorisez les notifications dans les réglages du navigateur.'
          : "L'activation des notifications a échoué.",
      );
    }
  }

  protected async signOut(): Promise<void> {
    await this.store.signOut();
    await this.router.navigateByUrl('/login');
  }
}
