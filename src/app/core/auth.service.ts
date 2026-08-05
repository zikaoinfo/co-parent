import { Injectable, computed, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase.client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _session = signal<Session | null>(null);

  readonly session = this._session.asReadonly();
  readonly userId = computed(() => this._session()?.user.id ?? null);
  readonly email = computed(() => this._session()?.user.email ?? null);

  /** Résolu quand la session initiale est connue (y compris magic link dans l'URL). */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = supabase.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
    });
  }

  /**
   * Envoie le magic link. `redirectPath` est relatif à la base de l'app
   * (respecte le base href de GitHub Pages).
   */
  async sendMagicLink(email: string, redirectPath = ''): Promise<void> {
    const redirectTo = new URL(redirectPath.replace(/^\//, ''), document.baseURI).href;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }
}
