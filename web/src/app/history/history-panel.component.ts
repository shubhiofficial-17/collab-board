import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BoardsApi } from '../boards/boards-api.service';
import { VersionDetail, VersionSummary } from '../boards/board';
import { ShapePreviewComponent } from './shape-preview.component';

/** Version history of a board: browse, preview, save a named version, restore. */
@Component({
  selector: 'app-history-panel',
  standalone: true,
  imports: [DatePipe, FormsModule, ShapePreviewComponent],
  templateUrl: './history-panel.component.html',
  styleUrl: './history-panel.component.css',
})
export class HistoryPanelComponent implements OnInit {
  private readonly api = inject(BoardsApi);

  readonly boardId = input.required<string>();
  readonly canEdit = input(true);
  readonly closed = output<void>();
  /** A version was restored; the board should reload in case live updates are off. */
  readonly restored = output<void>();

  readonly versions = signal<VersionSummary[] | null>(null);
  readonly selected = signal<VersionDetail | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  name = '';

  ngOnInit(): void {
    this.reload();
  }

  open(version: VersionSummary): void {
    this.api.version(this.boardId(), version.id).subscribe({
      next: (detail) => this.selected.set(detail),
      error: () => this.error.set("Couldn't open that version."),
    });
  }

  save(): void {
    const name = this.name.trim();
    if (!name || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.api.saveVersion(this.boardId(), name).subscribe({
      next: () => {
        this.name = '';
        this.busy.set(false);
        this.reload();
      },
      error: () => this.fail("Couldn't save the version."),
    });
  }

  restore(): void {
    const version = this.selected();
    if (!version || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.api.restoreVersion(this.boardId(), version.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.selected.set(null);
        this.restored.emit();
        this.reload();
      },
      error: () => this.fail("Couldn't restore the version."),
    });
  }

  label(version: { name: string | null }): string {
    return version.name ?? 'Automatic';
  }

  private reload(): void {
    this.api.versions(this.boardId()).subscribe({
      next: (versions) => this.versions.set(versions),
      error: () => this.error.set("Couldn't load the history. Check your connection."),
    });
  }

  private fail(message: string): void {
    this.busy.set(false);
    this.error.set(message);
  }
}
