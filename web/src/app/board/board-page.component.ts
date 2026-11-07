import { Component, ElementRef, HostListener, OnInit, effect, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Board } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';
import { BoardState } from './board-state';
import { BoardSync } from './board-sync';
import { BoardCanvasComponent } from './canvas/board-canvas.component';
import { ToolbarComponent } from './toolbar/toolbar.component';

@Component({
  selector: 'app-board-page',
  standalone: true,
  imports: [RouterLink, BoardCanvasComponent, ToolbarComponent],
  // One state and one save queue per open board.
  providers: [BoardState, BoardSync],
  templateUrl: './board-page.component.html',
  styleUrl: './board-page.component.css',
})
export class BoardPageComponent implements OnInit {
  private readonly api = inject(BoardsApi);
  private readonly state = inject(BoardState);
  readonly sync = inject(BoardSync);

  /** Bound from the :id route parameter (withComponentInputBinding). */
  readonly id = input.required<string>();

  readonly board = signal<Board | null>(null);
  readonly notFound = signal(false);
  readonly loaded = signal(false);
  readonly renaming = signal(false);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  constructor() {
    effect(() => this.titleInput()?.nativeElement.select());
  }

  ngOnInit(): void {
    this.api.get(this.id()).subscribe({
      next: (content) => {
        this.board.set(content);
        this.state.load(content.shapes);
        this.sync.start(content.id, this.state.committed);
        this.loaded.set(true);
      },
      error: () => this.notFound.set(true),
    });
  }

  rename(title: string): void {
    this.renaming.set(false);
    const board = this.board();
    const trimmed = title.trim();
    if (!board || !trimmed || trimmed === board.title) {
      return;
    }

    this.board.set({ ...board, title: trimmed });
    this.api.rename(board.id, trimmed).subscribe({
      next: (saved) => this.board.set(saved),
      error: () => this.board.set(board),
    });
  }

  onTitleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      this.renaming.set(false);
    }
  }

  /** Warn before closing the tab while changes are still being saved. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.sync.hasUnsavedChanges) {
      event.preventDefault();
    }
  }
}
