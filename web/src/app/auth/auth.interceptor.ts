import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** When the API says the session is gone, go to the sign-in page (and come back afterwards). */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.startsWith('/api/account')) {
        auth.sessionExpired();
        void router.navigate(['/sign-in'], { queryParams: { returnUrl: router.url } });
      }

      return throwError(() => error);
    }),
  );
};
