import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { BoardsApi } from '../boards/boards-api.service';
import { ShareRole, Sharing } from '../boards/board';

/** The owner's sharing panel: invite links for editors and viewers, and who has access. */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  templateUrl: './share-dialog.component.html',
  styleUrl: './share-dialog.component.css',
})
export class ShareDialogComponent implements OnInit {
  private readonly api = inject(BoardsApi);

  readonly boardId = input.required<string>();
  readonly closed = output<void>();

  readonly sharing = signal<Sharing | null>(null);
  readonly error = signal<string | null>(null);
  readonly copied = signal<ShareRole | null>(null);
  readonly roles: ShareRole[] = ['editor', 'viewer'];

  ngOnInit(): void {
    this.reload();
  }

  linkFor(role: ShareRole): string | null {
    const link = this.sharing()?.links.find((l) => l.role === role);
    return link ? `${location.origin}/invite/${link.token}` : null;
  }

  createLink(role: ShareRole): void {
    this.api.createLink(this.boardId(), role).subscribe({ next: () => this.reload(), error: () => this.failed() });
  }

  removeLink(role: ShareRole): void {
    this.api.removeLink(this.boardId(), role).subscribe({ next: () => this.reload(), error: () => this.failed() });
  }

  async copy(role: ShareRole): Promise<void> {
    const link = this.linkFor(role);
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(role);
    } catch {
      this.error.set('Copying was blocked by the browser; select the link and copy it instead.');
    }
  }

  setRole(userId: string, role: string): void {
    this.api.setRole(this.boardId(), userId, role as ShareRole).subscribe({ next: () => this.reload(), error: () => this.failed() });
  }

  remove(userId: string): void {
    this.api.removeMember(this.boardId(), userId).subscribe({ next: () => this.reload(), error: () => this.failed() });
  }

  private reload(): void {
    this.api.sharing(this.boardId()).subscribe({
      next: (sharing) => {
        this.sharing.set(sharing);
        this.error.set(null);
      },
      error: () => this.failed(),
    });
  }

  private failed(): void {
    this.error.set("Couldn't update sharing. Check your connection and try again.");
  }
}
