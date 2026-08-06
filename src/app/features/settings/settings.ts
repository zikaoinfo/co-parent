import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { dayLabel } from '../../core/calendar';
import { FamilyConfig, ParentIndex, RotationType, dateKey, lastMonday, parseKey } from '../../core/custody';
import { HolidayZone } from '../../core/holidays';
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
  protected holidayZone: HolidayZone | '';
  protected holidaySplit: boolean;
  protected firstHalfEvenYears: ParentIndex;
  protected notifyByEmail: boolean;
  protected readonly saving = signal(false);

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
    this.holidayZone = config?.holidays?.zone ?? '';
    this.holidaySplit = config?.holidays?.split ?? false;
    this.firstHalfEvenYears = config?.holidays?.firstHalfEvenYears ?? 0;
    this.notifyByEmail = config?.notifyByEmail ?? true;
  }

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

  protected updateChild(index: number, value: string): void {
    this.children.update((list) => list.map((c, i) => (i === index ? value : c)));
  }

  protected async save(): Promise<void> {
    const children = this.children()
      .map((c) => c.trim())
      .filter(Boolean);
    if (!this.parent0.trim() || !this.parent1.trim() || children.length === 0) {
      this.toast.show('Renseignez les deux prénoms et au moins un enfant.');
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
