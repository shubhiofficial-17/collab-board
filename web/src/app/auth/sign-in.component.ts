import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.css',
})
export class SignInComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Bound from the ?returnUrl= query parameter. */
  readonly returnUrl = input<string | undefined>();

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  email = '';
  name = '';
  password = '';

  toggle(): void {
    this.mode.update((mode) => (mode === 'signin' ? 'signup' : 'signin'));
    this.error.set(null);
  }

  submit(): void {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    const request =
      this.mode() === 'signin'
        ? this.auth.signIn(this.email, this.password)
        : this.auth.signUp(this.email, this.name, this.password);
    request.subscribe({
      next: () => void this.router.navigateByUrl(safeReturnUrl(this.returnUrl())),
      error: (error: unknown) => {
        this.error.set(messageFor(error));
        this.busy.set(false);
      },
    });
  }
}

/** Only paths inside this app, so a crafted link can't send people elsewhere after signing in. */
function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

function messageFor(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const problem = error.error as { detail?: string; errors?: Record<string, string[]> } | null;
    const fieldError = problem?.errors && Object.values(problem.errors)[0]?.[0];
    if (fieldError || problem?.detail) {
      return fieldError ?? problem!.detail!;
    }

    if (error.status === 0) {
      return "Can't reach the server. Check your connection.";
    }
  }

  return 'Something went wrong. Try again.';
}
