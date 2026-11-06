import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BoardsApi } from '../boards/boards-api.service';

/** Opened from an invite link: joins the board, then opens it. */
@Component({
  selector: 'app-invite',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="message">
      @if (error(); as message) {
        <p role="alert">{{ message }}</p>
        <a routerLink="/">Back to boards</a>
      } @else {
        <p>Joining the board…</p>
      }
    </main>
  `,
  styles: `
    .message {
      max-width: 480px;
      margin: 80px auto;
      text-align: center;
    }
  `,
})
export class InviteComponent implements OnInit {
  private readonly api = inject(BoardsApi);
  private readonly router = inject(Router);

  /** Bound from the :token route parameter. */
  readonly token = input.required<string>();
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.acceptInvite(this.token()).subscribe({
      next: ({ boardId }) => void this.router.navigate(['/b', boardId], { replaceUrl: true }),
      error: (error: unknown) =>
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 404
            ? 'This invite link is invalid or has been turned off. Ask the board owner for a new one.'
            : "Couldn't join the board. Check your connection and try again.",
        ),
    });
  }
}
