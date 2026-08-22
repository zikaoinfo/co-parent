import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { dayLabel, timeLabel } from '../../core/calendar';
import {
  Custodian,
  Handover,
  ParentIndex,
  custodianFor,
  handoverPickup,
  handoversFor,
  holidayCustodian,
} from '../../core/custody';
import { holidayFor } from '../../core/holidays';
import { EventRow, FamilyStore } from '../../core/family.store';
import { ToastService } from '../../core/toast.service';

/**
 * Panneau du jour sélectionné : gardien + échange, événements, note de
 * passation. Bottom sheet en mobile.
 */
@Component({
  selector: 'app-day-panel',
  imports: [FormsModule],
  templateUrl: './day-panel.html',
  styleUrl: './day-panel.css',
})
export class DayPanel {
  protected readonly store = inject(FamilyStore);
  private readonly toast = inject(ToastService);

  readonly day = input.required<string>();
  readonly closed = output<void>();

  protected eventTitle = '';
  protected eventTime = '';
  protected readonly noteDraft = signal('');
  protected readonly busy = signal(false);

  protected readonly label = computed(() => dayLabel(this.day()));

  protected readonly custodian = computed<Custodian>(() => {
    const config = this.store.config();
    if (!config) return -1;
    return custodianFor(this.day(), config, this.store.overrideIndex());
  });

  /** Gardien donné par la rotation/vacances (sans échange ponctuel). */
  protected readonly rotationCustodian = computed<Custodian>(() => {
    const config = this.store.config();
    if (!config) return -1;
    return custodianFor(this.day(), config, {});
  });

  /** Nom de la période de vacances scolaires couvrant ce jour, sinon null. */
  protected readonly holidayName = computed<string | null>(() => {
    const holidays = this.store.config()?.holidays;
    if (!holidays) return null;
    return holidayFor(this.day(), holidays.zone)?.name ?? null;
  });

  /** Le gardien du jour vient-il du partage vacances (et non de la rotation) ? */
  protected readonly fromHolidaySplit = computed<boolean>(() => {
    const config = this.store.config();
    if (!config) return false;
    return (
      !(this.day() in this.store.overrideIndex()) && holidayCustodian(this.day(), config) !== null
    );
  });

  /** Passations programmées ce jour-là (réglages), triées par heure. */
  protected readonly handovers = computed<Handover[]>(() => {
    const config = this.store.config();
    return config ? handoversFor(this.day(), config) : [];
  });

  /** « Léa », « Léa et Tom », « Léa, Tom et Zoé ». */
  protected readonly childrenLabel = computed(() => {
    const names = this.store.config()?.children ?? [];
    if (names.length === 0) return "l'enfant";
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
  });

  protected readonly events = computed<EventRow[]>(
    () => this.store.eventsByDay()[this.day()] ?? [],
  );

  protected readonly note = computed(() => this.store.notes()[this.day()] ?? null);

  protected readonly override = computed(() => this.store.overrides()[this.day()] ?? null);

  constructor() {
    // Recharge le brouillon de note quand le jour change ou quand la note
    // arrive par realtime (sans écraser une saisie en cours identique).
    effect(() => {
      this.day();
      this.noteDraft.set(this.note()?.note ?? '');
    });
  }

  protected parentName(index: Custodian): string {
    const config = this.store.config();
    if (!config || index === -1) return 'Non attribué';
    return config.parents[index];
  }

  /** Parent qui vient chercher, ou libellé générique si le jour n'est pas attribué. */
  protected pickupName(handover: Handover): string {
    const config = this.store.config();
    if (!config) return 'Le parent qui prend la garde';
    const who = handoverPickup(handover, this.day(), config, this.store.overrideIndex());
    return who === -1 ? 'Le parent qui prend la garde' : config.parents[who];
  }

  protected authorName(userId: string | null): string | null {
    if (!userId) return null;
    const index = this.store.membersByUser()[userId];
    return index === undefined ? null : this.parentName(index);
  }

  protected authorIndex(userId: string | null): ParentIndex | null {
    if (!userId) return null;
    return this.store.membersByUser()[userId] ?? null;
  }

  protected lastEdit(row: { updated_by: string | null; updated_at: string } | null): string | null {
    if (!row) return null;
    const name = this.authorName(row.updated_by);
    return name ? `Dernière modif par ${name} à ${timeLabel(row.updated_at)}` : null;
  }

  /** Passe le jour chez le parent donné (ou retire l'échange si retour à la rotation). */
  protected async assignTo(target: ParentIndex): Promise<void> {
    if (!this.store.online()) return;
    this.busy.set(true);
    try {
      const backToRotation = this.rotationCustodian() === target;
      await this.store.setDayCustodian(this.day(), backToRotation ? null : target);
      this.toast.show(
        backToRotation
          ? 'Échange annulé, retour au rythme habituel'
          : `Jour confié à ${this.parentName(target)}`,
      );
    } catch {
      this.toast.show("L'échange a échoué, réessayez.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async addEvent(): Promise<void> {
    const title = this.eventTitle.trim();
    if (!title || !this.store.online()) return;
    this.busy.set(true);
    try {
      await this.store.addEvent(this.day(), title, this.eventTime || null);
      this.eventTitle = '';
      this.eventTime = '';
      this.toast.show('Événement ajouté');
    } catch {
      this.toast.show("L'ajout a échoué, réessayez.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteEvent(id: number): Promise<void> {
    if (!this.store.online()) return;
    try {
      await this.store.deleteEvent(id);
      this.toast.show('Événement supprimé');
    } catch {
      this.toast.show('La suppression a échoué, réessayez.');
    }
  }

  protected async saveNote(): Promise<void> {
    if (!this.store.online()) return;
    const current = this.note()?.note ?? '';
    if (this.noteDraft().trim() === current.trim()) return;
    try {
      await this.store.saveNote(this.day(), this.noteDraft());
      this.toast.show('Note enregistrée');
    } catch {
      this.toast.show("L'enregistrement de la note a échoué.");
    }
  }
}
