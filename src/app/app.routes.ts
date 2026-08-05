import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from './core/auth.service';
import { FamilyStore } from './core/family.store';

/** Non connecté -> /login. */
const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.session() ? true : router.parseUrl('/login');
};

/** Connecté mais sans famille -> /setup. */
const familyGuard: CanActivateFn = async () => {
  const store = inject(FamilyStore);
  const router = inject(Router);
  await store.whenChecked();
  return store.familyId() ? true : router.parseUrl('/setup');
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard, familyGuard],
    loadComponent: () => import('./features/calendar/calendar').then((m) => m.CalendarPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'setup',
    canActivate: [authGuard],
    loadComponent: () => import('./features/setup/setup').then((m) => m.SetupPage),
  },
  {
    path: 'join/:token',
    loadComponent: () => import('./features/join/join').then((m) => m.JoinPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard, familyGuard],
    loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
