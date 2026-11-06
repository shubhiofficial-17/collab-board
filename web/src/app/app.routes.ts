import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent) },
  { path: 'b/:id', loadComponent: () => import('./board/board-page.component').then((m) => m.BoardPageComponent) },
  { path: '**', redirectTo: '' },
];
