import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Board, BoardRole } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';
import { AuthService } from '../auth/auth.service';
import { loadIdentity } from '../realtime/identity';
import { RealtimeService } from '../realtime/realtime.service';
import { StampedOp } from './model/crdt';
import { Point } from './model/viewport';
import { BoardState } from './board-state';
import { BoardSync } from './board-sync';
import { BoardCanvasComponent } from './canvas/board-canvas.component';
import { OfflineCache } from './offline-cache';
import { ShareDialogComponent } from '../sharing/share-dialog.component';
import { HistoryPanelComponent } from '../history/history-panel.component';
import { ToolbarComponent } from './toolbar/toolbar.component';

@Component({
  selector: 'app-board-page',
  standalone: true,
  imports: [RouterLink, BoardCanvasComponent, ToolbarComponent, ShareDialogComponent, HistoryPanelComponent],
  // One state, save queue and live connection per open board.
  providers: [BoardState, BoardSync, RealtimeService],
  templateUrl: './board-page.component.html',
  styleUrl: './board-page.component.css',
})
export class BoardPageComponent implements OnInit {
  private readonly api = inject(BoardsApi);
  private readonly state = inject(BoardState);
  private readonly cache = inject(OfflineCache);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly sync = inject(BoardSync);
  readonly realtime = inject(RealtimeService);

  /** Bound from the :id route parameter (withComponentInputBinding). */
  readonly id = input.required<string>();

  readonly board = signal<Board | null>(null);
  readonly notFound = signal(false);
  readonly loaded = signal(false);
  readonly renaming = signal(false);
  /** Opened from the local copy because the server couldn't be reached. */
  readonly fromCache = signal(false);
  readonly sharingOpen = signal(false);
  readonly historyOpen = signal(false);
  /** This user's role. Unknown (e.g. no members listed) counts as editor; the server has the final say. */
  readonly role = computed<BoardRole>(() => {
    const me = this.auth.me();
    return this.board()?.members?.find((m) => m.userId === me?.id)?.role ?? 'editor';
  });
  readonly canEdit = computed(() => this.role() !== 'viewer');
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  constructor() {
    effect(() => this.titleInput()?.nativeElement.select());
    effect(() => this.state.readOnly.set(!this.canEdit()), { allowSignalWrites: true });

    // Keep a local copy of the board, so it can be opened offline. Written a moment after changes
    // settle rather than on every pointer move during a drag.
    let timer: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const shapes = this.state.allShapes();
      const board = this.board();
      if (!this.loaded() || !board) {
        return;
      }

      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        this.cache.saveSnapshot(board, shapes);
      }, 300);
    });
    this.destroyRef.onDestroy(() => timer !== null && clearTimeout(timer));
  }

  ngOnInit(): void {
    const id = this.id();
    const cached = this.cache.load(id);
    this.api.get(id).subscribe({
      next: (content) => {
        this.state.load(content.shapes);
        if (cached?.pending.length) {
          // Changes made offline last time: show them on top of the server copy, then send them.
          this.state.resync(content.shapes, cached.pending);
        }
        this.cache.saveSnapshot(content, this.state.allShapes());
        this.open(content, cached?.pending ?? []);
      },
      error: (error: unknown) => {
        if (cached && isUnreachable(error)) {
          this.state.load(cached.shapes);
          this.fromCache.set(true);
          this.open(cached.board, cached.pending);
        } else {
          this.cache.remove(id);
          this.notFound.set(true);
        }
      },
    });
  }

  private open(board: Board, pending: readonly StampedOp[]): void {
    this.board.set(board);
    this.sync.unsavedChanged
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((unsaved) => this.cache.savePending(board.id, unsaved));
    this.sync.start(board.id, this.state.committed, () => this.realtime.connectionId, pending);
    this.loaded.set(true);
    const identity = loadIdentity();
    void this.realtime.connect(board.id, { ...identity, name: this.auth.me()?.name ?? identity.name }, {
      onOps: (message) => this.state.applyRemote(message.ops),
      onResync: () => this.resync(),
    });
  }

  /** The browser is back online: send unsaved changes and reconnect. */
  @HostListener('window:online')
  onOnline(): void {
    this.sync.retryNow();
    void this.realtime.retry();
  }

  onCursorMoved(point: Point): void {
    this.realtime.moveCursor(point.x, point.y);
  }

  /** After a reconnect (or a restore), changes may have been missed: reload the board, keeping unsaved local edits. */
  resync(): void {
    const board = this.board();
    if (!board) {
      return;
    }

    this.sync.retryNow();
    this.api.get(board.id).subscribe({
      next: (content) => {
        this.state.resync(content.shapes, this.sync.unsaved);
        this.fromCache.set(false);
      },
    });
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
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

/** No response, or the server is failing: worth falling back to the local copy. */
function isUnreachable(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}
