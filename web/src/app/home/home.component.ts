import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Board } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent implements OnInit {
  private readonly api = inject(BoardsApi);
  private readonly router = inject(Router);

  readonly boards = signal<Board[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  title = '';

  ngOnInit(): void {
    this.api.list().subscribe({
      next: (boards) => {
        this.boards.set(boards);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load boards. Is the API running?');
        this.loading.set(false);
      },
    });
  }

  create(): void {
    if (this.creating()) {
      return;
    }

    this.creating.set(true);
    this.error.set(null);
    this.api.create(this.title).subscribe({
      next: (board) => this.router.navigate(['/b', board.id]),
      error: () => {
        this.error.set('Could not create the board. Try again.');
        this.creating.set(false);
      },
    });
  }
}
