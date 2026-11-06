import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Board } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';

@Component({
  selector: 'app-board-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './board-page.component.html',
  styleUrl: './board-page.component.css',
})
export class BoardPageComponent implements OnInit {
  private readonly api = inject(BoardsApi);

  /** Bound from the :id route parameter (withComponentInputBinding). */
  readonly id = input.required<string>();

  readonly board = signal<Board | null>(null);
  readonly notFound = signal(false);

  ngOnInit(): void {
    this.api.get(this.id()).subscribe({
      next: (board) => this.board.set(board),
      error: () => this.notFound.set(true),
    });
  }
}
