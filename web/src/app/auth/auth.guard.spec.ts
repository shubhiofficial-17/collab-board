import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('authGuard', () => {
  function run(signedIn: boolean) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ensureLoaded: () => Promise.resolve(signedIn ? { id: 'u1' } : null) } },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/b/abc' } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  }

  it('lets signed-in users through', async () => {
    expect(await run(true)).toBeTrue();
  });

  it('sends everyone else to sign in, remembering where they were going', async () => {
    const result = await run(false);

    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/sign-in?returnUrl=%2Fb%2Fabc');
  });
});
