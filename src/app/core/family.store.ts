import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { dayLabel } from './calendar';
import { CustodyOverrides, FamilyConfig, ParentIndex } from './custody';
import { supabase } from './supabase.client';

export interface OverrideRow {
  day: string;
  parent_index: ParentIndex;
  updated_by: string | null;
  updated_at: string;
}

export interface EventRow {
  id: number;
  day: string;
  title: string;
  time: string | null;
  created_by: string | null;
}

export interface NoteRow {
  day: string;
  note: string;
  updated_by: string | null;
  updated_at: string;
}

interface CacheSnapshot {
  familyId: string | null;
  myIndex: ParentIndex | null;
  membersByUser: Record<string, ParentIndex>;
  config: FamilyConfig | null;
  overrides: Record<string, OverrideRow>;
  events: EventRow[];
  notes: Record<string, NoteRow>;
}

const CACHE_KEY = 'notre-garde:v1';

/**
 * Store signals de la famille, adossé à Supabase :
 * - chargement initial + cache localStorage (lecture offline),
 * - subscriptions Postgres Changes filtrées family_id (patch des signals),
 * - re-fetch complet au retour d'onglet (visibilitychange) et au retour réseau,
 * - mutations (overrides, événements, notes, config) — refusées hors ligne.
 */
@Injectable({ providedIn: 'root' })
export class FamilyStore {
  private readonly auth = inject(AuthService);

  readonly familyId = signal<string | null>(null);
  readonly myIndex = signal<ParentIndex | null>(null);
  readonly membersByUser = signal<Record<string, ParentIndex>>({});
  readonly config = signal<FamilyConfig | null>(null);
  readonly inviteToken = signal<string | null>(null);
  readonly overrides = signal<Record<string, OverrideRow>>({});
  readonly events = signal<EventRow[]>([]);
  readonly notes = signal<Record<string, NoteRow>>({});
  readonly online = signal(navigator.onLine);

  /** Record jour -> gardien, forme attendue par custodianFor. */
  readonly overrideIndex = computed<CustodyOverrides>(() =>
    Object.fromEntries(Object.entries(this.overrides()).map(([d, r]) => [d, r.parent_index])),
  );

  readonly eventsByDay = computed<Record<string, EventRow[]>>(() => {
    const map: Record<string, EventRow[]> = {};
    for (const e of this.events()) {
      (map[e.day] ??= []).push(e);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.id - b.id);
    }
    return map;
  });

  /** La famille a-t-elle ses deux parents ? */
  readonly complete = computed(() => Object.keys(this.membersByUser()).length >= 2);

  private channel: RealtimeChannel | null = null;
  private checked = false;
  private checkedWaiters: (() => void)[] = [];
  private loadedForUser: string | null = null;

  constructor() {
    this.hydrateFromCache();

    // Persiste l'état en cache à chaque changement (lecture offline).
    effect(() => {
      const snapshot: CacheSnapshot = {
        familyId: this.familyId(),
        myIndex: this.myIndex(),
        membersByUser: this.membersByUser(),
        config: this.config(),
        overrides: this.overrides(),
        events: this.events(),
        notes: this.notes(),
      };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
      } catch {
        // cache plein ou indisponible : tant pis, l'app reste fonctionnelle
      }
    });

    // Charge / décharge selon la session (login tardif, logout).
    effect(() => {
      const uid = this.auth.userId();
      untracked(() => void this.onUserChange(uid));
    });

    window.addEventListener('online', () => {
      this.online.set(true);
      void this.refresh();
    });
    window.addEventListener('offline', () => this.online.set(false));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.refresh();
    });
  }

  /** Résolu quand l'adhésion de l'utilisateur courant a été vérifiée. */
  whenChecked(): Promise<void> {
    if (this.checked) return Promise.resolve();
    return new Promise((resolve) => this.checkedWaiters.push(resolve));
  }

  private async onUserChange(uid: string | null): Promise<void> {
    await this.auth.ready;
    if (uid === this.loadedForUser && this.checked) return;
    this.loadedForUser = uid;
    if (!uid) {
      this.clear();
      this.markChecked();
      return;
    }
    this.checked = false;
    await this.load(uid);
    this.markChecked();
  }

  private markChecked(): void {
    this.checked = true;
    this.checkedWaiters.forEach((resolve) => resolve());
    this.checkedWaiters = [];
  }

  private async load(uid: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('family_members')
        .select('family_id, user_id, parent_index');
      if (error) throw error;
      const mine = data.find((r) => r.user_id === uid);
      if (!mine) {
        this.clear();
        return;
      }
      this.familyId.set(mine.family_id);
      this.myIndex.set(mine.parent_index as ParentIndex);
      this.membersByUser.set(
        Object.fromEntries(
          data
            .filter((r) => r.family_id === mine.family_id)
            .map((r) => [r.user_id, r.parent_index as ParentIndex]),
        ),
      );
      await this.refresh();
      this.subscribeRealtime(mine.family_id);
    } catch {
      // Réseau indisponible : on garde l'état du cache (lecture offline).
    }
  }

  /** Re-fetch complet de toutes les tables de la famille. */
  async refresh(): Promise<void> {
    const fid = this.familyId();
    if (!fid || !this.auth.userId()) return;
    try {
      const [family, members, overrides, events, notes] = await Promise.all([
        supabase.from('families').select('config').eq('id', fid).single(),
        supabase.from('family_members').select('user_id, parent_index').eq('family_id', fid),
        supabase.from('custody_overrides').select('day, parent_index, updated_by, updated_at').eq('family_id', fid),
        supabase.from('events').select('id, day, title, time, created_by').eq('family_id', fid),
        supabase.from('day_notes').select('day, note, updated_by, updated_at').eq('family_id', fid),
      ]);
      if (family.error || members.error || overrides.error || events.error || notes.error) return;
      this.config.set(family.data.config as FamilyConfig);
      this.membersByUser.set(
        Object.fromEntries(members.data.map((r) => [r.user_id, r.parent_index as ParentIndex])),
      );
      this.overrides.set(Object.fromEntries(overrides.data.map((r) => [r.day, r as OverrideRow])));
      this.events.set(events.data as EventRow[]);
      this.notes.set(Object.fromEntries(notes.data.map((r) => [r.day, r as NoteRow])));
    } catch {
      // hors ligne : état conservé
    }
  }

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  private subscribeRealtime(fid: string): void {
    if (this.channel) {
      void supabase.removeChannel(this.channel);
    }
    const opts = (table: string) => ({
      event: '*' as const,
      schema: 'public',
      table,
      filter: `family_id=eq.${fid}`,
    });
    this.channel = supabase
      .channel(`family-${fid}`)
      .on('postgres_changes', opts('custody_overrides'), (p) =>
        this.patchOverride(p as RealtimePostgresChangesPayload<OverrideRow>))
      .on('postgres_changes', opts('events'), (p) =>
        this.patchEvent(p as RealtimePostgresChangesPayload<EventRow>))
      .on('postgres_changes', opts('day_notes'), (p) =>
        this.patchNote(p as RealtimePostgresChangesPayload<NoteRow>))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'families', filter: `id=eq.${fid}` },
        (p) => this.config.set((p.new as { config: FamilyConfig }).config))
      .subscribe();
  }

  private patchOverride(p: RealtimePostgresChangesPayload<OverrideRow>): void {
    this.overrides.update((current) => {
      const next = { ...current };
      if (p.eventType === 'DELETE') {
        delete next[(p.old as Partial<OverrideRow>).day!];
      } else {
        next[p.new.day] = p.new;
      }
      return next;
    });
  }

  private patchEvent(p: RealtimePostgresChangesPayload<EventRow>): void {
    this.events.update((current) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as Partial<EventRow>).id;
        return current.filter((e) => e.id !== id);
      }
      return [...current.filter((e) => e.id !== p.new.id), p.new];
    });
  }

  private patchNote(p: RealtimePostgresChangesPayload<NoteRow>): void {
    this.notes.update((current) => {
      const next = { ...current };
      if (p.eventType === 'DELETE') {
        delete next[(p.old as Partial<NoteRow>).day!];
      } else {
        next[p.new.day] = p.new;
      }
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Onboarding
  // -------------------------------------------------------------------------

  async createFamily(config: FamilyConfig): Promise<void> {
    const { data, error } = await supabase.rpc('create_family', { config });
    if (error) throw error;
    this.inviteToken.set(data.invite_token);
    await this.onUserReload();
  }

  async joinFamily(token: string): Promise<void> {
    const { error } = await supabase.rpc('join_family', { invite_token: token });
    if (error) throw error;
    await this.onUserReload();
  }

  async regenerateInvitation(): Promise<string> {
    const { data, error } = await supabase.rpc('regenerate_invitation', { fid: this.familyId() });
    if (error) throw error;
    this.inviteToken.set(data);
    return data;
  }

  private async onUserReload(): Promise<void> {
    const uid = this.auth.userId();
    if (uid) await this.load(uid);
  }

  // -------------------------------------------------------------------------
  // Mutations calendrier (les composants vérifient online() avant d'appeler)
  // -------------------------------------------------------------------------

  /** Force le gardien d'un jour ; `null` retire l'échange (retour à la rotation). */
  async setDayCustodian(day: string, parentIndex: ParentIndex | null): Promise<void> {
    const fid = this.requireFamily();
    if (parentIndex === null) {
      const { error } = await supabase
        .from('custody_overrides')
        .delete()
        .eq('family_id', fid)
        .eq('day', day);
      if (error) throw error;
      this.overrides.update(({ [day]: _, ...rest }) => rest);
      this.notify(
        `${this.myName()} a annulé l'échange du ${dayLabel(day)} (retour au rythme habituel).`,
      );
      return;
    }
    const row = {
      family_id: fid,
      day,
      parent_index: parentIndex,
      updated_by: this.auth.userId(),
    };
    const { data, error } = await supabase
      .from('custody_overrides')
      .upsert(row)
      .select('day, parent_index, updated_by, updated_at')
      .single();
    if (error) throw error;
    this.overrides.update((current) => ({ ...current, [day]: data as OverrideRow }));
    this.notify(
      `${this.myName()} a passé le ${dayLabel(day)} chez ${this.parentName(parentIndex)}.`,
    );
  }

  async addEvent(day: string, title: string, time: string | null): Promise<void> {
    const fid = this.requireFamily();
    const { data, error } = await supabase
      .from('events')
      .insert({ family_id: fid, day, title, time: time || null, created_by: this.auth.userId() })
      .select('id, day, title, time, created_by')
      .single();
    if (error) throw error;
    this.events.update((current) => [...current.filter((e) => e.id !== data.id), data as EventRow]);
    this.notify(
      `${this.myName()} a ajouté « ${title} » le ${dayLabel(day)}${time ? ` à ${time}` : ''}.`,
    );
  }

  async deleteEvent(id: number): Promise<void> {
    const removed = this.events().find((e) => e.id === id);
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw error;
    this.events.update((current) => current.filter((e) => e.id !== id));
    if (removed) {
      this.notify(`${this.myName()} a supprimé « ${removed.title} » du ${dayLabel(removed.day)}.`);
    }
  }

  /** Enregistre la note du jour ; une note vide la supprime. */
  async saveNote(day: string, note: string): Promise<void> {
    const fid = this.requireFamily();
    const trimmed = note.trim();
    if (!trimmed) {
      const { error } = await supabase.from('day_notes').delete().eq('family_id', fid).eq('day', day);
      if (error) throw error;
      this.notes.update(({ [day]: _, ...rest }) => rest);
      this.notify(`${this.myName()} a supprimé la note du ${dayLabel(day)}.`);
      return;
    }
    const row = { family_id: fid, day, note: trimmed, updated_by: this.auth.userId() };
    const { data, error } = await supabase
      .from('day_notes')
      .upsert(row)
      .select('day, note, updated_by, updated_at')
      .single();
    if (error) throw error;
    this.notes.update((current) => ({ ...current, [day]: data as NoteRow }));
    this.notify(`${this.myName()} a mis à jour la note du ${dayLabel(day)} : « ${trimmed} »`);
  }

  async updateConfig(config: FamilyConfig): Promise<void> {
    const fid = this.requireFamily();
    const { error } = await supabase.from('families').update({ config }).eq('id', fid);
    if (error) throw error;
    this.config.set(config);
    this.notify(`${this.myName()} a modifié les réglages de la famille.`);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.clear();
    localStorage.removeItem(CACHE_KEY);
  }

  // -------------------------------------------------------------------------

  /**
   * Notifie l'autre parent (push sur ses appareils abonnés + e-mail si le
   * réglage de la famille l'active — l'Edge Function notify-change arbitre)
   * en fire-and-forget : un échec d'envoi ne bloque jamais la modification.
   */
  private notify(message: string): void {
    const fid = this.familyId();
    if (!fid) return;
    void supabase.functions
      .invoke('notify-change', { body: { family_id: fid, message } })
      .catch(() => {});
  }

  private myName(): string {
    const config = this.config();
    const index = this.myIndex();
    return config && index !== null ? config.parents[index] : 'Un parent';
  }

  private parentName(index: ParentIndex): string {
    return this.config()?.parents[index] ?? `Parent ${index + 1}`;
  }

  private requireFamily(): string {
    const fid = this.familyId();
    if (!fid) throw new Error('Aucune famille chargée');
    return fid;
  }

  private clear(): void {
    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.familyId.set(null);
    this.myIndex.set(null);
    this.membersByUser.set({});
    this.config.set(null);
    this.inviteToken.set(null);
    this.overrides.set({});
    this.events.set([]);
    this.notes.set({});
  }

  private hydrateFromCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as CacheSnapshot;
      this.familyId.set(snap.familyId);
      this.myIndex.set(snap.myIndex);
      this.membersByUser.set(snap.membersByUser ?? {});
      this.config.set(snap.config);
      this.overrides.set(snap.overrides ?? {});
      this.events.set(snap.events ?? []);
      this.notes.set(snap.notes ?? {});
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }
}
