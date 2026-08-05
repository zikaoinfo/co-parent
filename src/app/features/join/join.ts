import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { FamilyStore } from '../../core/family.store';
import { ToastService } from '../../core/toast.service';

/**
 * Onboarding du parent 2 : /join/<token>.
 * Sans session -> demande l'e-mail, le magic link ramène ici. Avec session ->
 * appelle join_family puis ouvre le calendrier.
 */
@Component({
  selector: 'app-join',
  imports: [FormsModule],
  templateUrl: './join.html',
  styleUrl: './join.css',
})
export class JoinPage {
  protected readonly auth = inject(AuthService);
  private readonly store = inject(FamilyStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected email = '';
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly joining = signal(false);
  protected readonly ready = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly token: string = this.route.snapshot.paramMap.get('token') ?? '';
  private joinAttempted = false;

  constructor() {
    void this.auth.ready.then(() => this.ready.set(true));
    // Dès qu'une session existe (arrivée via magic link ou déjà connecté),
    // tenter l'adhésion — une seule fois.
    effect(() => {
      const session = this.auth.session();
      if (session && this.ready() && !this.joinAttempted) {
        this.joinAttempted = true;
        untracked(() => void this.join());
      }
    });
  }

  protected async sendLink(): Promise<void> {
    const email = this.email.trim();
    if (!email) return;
    this.sending.set(true);
    this.errorMessage.set(null);
    try {
      await this.auth.sendMagicLink(email, `join/${this.token}`);
      this.sent.set(true);
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : '';
      this.errorMessage.set(`L'envoi a échoué${detail}. Vérifiez l'adresse et réessayez.`);
    } finally {
      this.sending.set(false);
    }
  }

  private async join(): Promise<void> {
    this.joining.set(true);
    try {
      await this.store.joinFamily(this.token);
      this.toast.show('Bienvenue dans la famille !');
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : "L'invitation n'a pas pu être utilisée.",
      );
    } finally {
      this.joining.set(false);
    }
  }
}
