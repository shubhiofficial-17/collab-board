import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: 'sign-in', loadComponent: () => import('./auth/sign-in.component').then((m) => m.SignInComponent) },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent) },
  {
    path: 'b/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./board/board-page.component').then((m) => m.BoardPageComponent),
  },
  { path: '**', redirectTo: '' },
];
