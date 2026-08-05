import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    // Déjà connecté (ou connexion aboutie dans un autre onglet) : vers l'app.
    effect(() => {
      if (this.auth.session()) void this.router.navigateByUrl('/');
    });
  }

  protected async send(): Promise<void> {
    const email = this.email.trim();
    if (!email) return;
    this.sending.set(true);
    this.errorMessage.set(null);
    try {
      await this.auth.sendMagicLink(email);
      this.sent.set(true);
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : '';
      this.errorMessage.set(`L'envoi a échoué${detail}. Vérifiez l'adresse et réessayez.`);
    } finally {
      this.sending.set(false);
    }
  }
}
