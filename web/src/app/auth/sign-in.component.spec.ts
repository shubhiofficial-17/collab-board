import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { SignInComponent } from './sign-in.component';

describe('SignInComponent', () => {
  let fixture: ComponentFixture<SignInComponent>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: Router;
  const ada = { id: 'u1', email: 'ada@example.com', name: 'Ada' };

  function setup(returnUrl?: string) {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['signIn', 'signUp']);
    TestBed.configureTestingModule({
      imports: [SignInComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(SignInComponent);
    if (returnUrl) {
      fixture.componentRef.setInput('returnUrl', returnUrl);
    }
    fixture.detectChanges();
  }

  it('signs in and goes back where you came from', () => {
    setup('/b/abc');
    auth.signIn.and.returnValue(of(ada));
    const component = fixture.componentInstance;
    component.email = 'ada@example.com';
    component.password = 'secret123';

    component.submit();

    expect(auth.signIn).toHaveBeenCalledWith('ada@example.com', 'secret123');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/b/abc');
  });

  it('never redirects to another site', () => {
    setup('//evil.example');
    auth.signIn.and.returnValue(of(ada));

    fixture.componentInstance.submit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('creates an account in sign-up mode', () => {
    setup();
    auth.signUp.and.returnValue(of(ada));
    fixture.nativeElement.querySelector('.switch button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name=name]')).not.toBeNull();

    const component = fixture.componentInstance;
    component.email = 'ada@example.com';
    component.name = 'Ada';
    component.password = 'secret123';
    component.submit();

    expect(auth.signUp).toHaveBeenCalledWith('ada@example.com', 'Ada', 'secret123');
  });

  it("shows the server's message when it fails", () => {
    setup();
    auth.signIn.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 401, error: { detail: 'Wrong email or password.' } })),
    );

    fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Wrong email or password.');
  });
});
