import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { supabase } from './supabase.client';

/**
 * Notifications push de cet appareil (Web Push).
 * Chaque appareil s'abonne individuellement ; l'abonnement est enregistré
 * dans push_subscriptions et l'Edge Function notify-change pousse vers les
 * appareils de l'autre parent. Sur iOS, l'app doit être installée sur
 * l'écran d'accueil (iOS 16.4+) pour que le push soit disponible.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly auth = inject(AuthService);

  /** Push disponible sur cet appareil (service worker actif + API présente). */
  readonly supported = this.swPush.isEnabled && 'Notification' in window;
  /** Cet appareil est-il abonné ? */
  readonly enabled = signal(false);
  /** Permission refusée définitivement par l'utilisateur. */
  readonly denied = signal(false);

  constructor() {
    if (this.supported) {
      this.denied.set(Notification.permission === 'denied');
      void firstValueFrom(this.swPush.subscription).then((sub) => this.enabled.set(sub !== null));
    }
  }

  async enable(): Promise<void> {
    const sub = await this.swPush.requestSubscription({
      serverPublicKey: environment.vapidPublicKey,
    });
    const key = sub.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint: sub.endpoint,
      user_id: this.auth.userId(),
      p256dh: key.keys?.['p256dh'] ?? '',
      auth: key.keys?.['auth'] ?? '',
    });
    if (error) throw error;
    this.enabled.set(true);
    this.denied.set(false);
  }

  async disable(): Promise<void> {
    const sub = await firstValueFrom(this.swPush.subscription);
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    this.enabled.set(false);
  }
}
