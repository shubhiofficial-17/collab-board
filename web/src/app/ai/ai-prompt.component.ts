import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BoardsApi } from '../boards/boards-api.service';
import { Shape } from '../board/model/shapes';

/** "Describe a diagram" box: sends the prompt and hands back the generated shapes. */
@Component({
  selector: 'app-ai-prompt',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="ai" (ngSubmit)="generate()" (keydown.escape)="closed.emit()">
      <label for="ai-prompt">Describe a diagram</label>
      <textarea
        id="ai-prompt"
        #promptInput
        name="prompt"
        rows="3"
        maxlength="500"
        placeholder="e.g. Onboarding flow for a new engineer"
        [(ngModel)]="prompt"
        (keydown.control.enter)="generate()"
        (keydown.meta.enter)="generate()"
      ></textarea>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button type="button" (click)="closed.emit()">Cancel</button>
        <button type="submit" class="primary" [disabled]="busy() || !prompt.trim()">{{ busy() ? 'Generating…' : 'Generate' }}</button>
      </div>
    </form>
  `,
  styles: `
    .ai {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 320px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
      z-index: 6;
    }
    label {
      font-weight: 500;
    }
    textarea {
      resize: vertical;
      font: inherit;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .error {
      margin: 0;
      color: var(--danger);
      font-size: 0.85rem;
    }
  `,
})
export class AiPromptComponent {
  private readonly api = inject(BoardsApi);
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('promptInput');

  readonly boardId = input.required<string>();
  /** Where to put the diagram, in board coordinates (usually the middle of the view). */
  readonly center = input.required<{ x: number; y: number }>();
  readonly generated = output<Shape[]>();
  readonly closed = output<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  prompt = '';

  constructor() {
    afterNextRender(() => this.input()?.nativeElement.focus());
  }

  generate(): void {
    const prompt = this.prompt.trim();
    if (!prompt || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    const { x, y } = this.center();
    this.api.generateDiagram(this.boardId(), prompt, x, y).subscribe({
      next: ({ shapes }) => {
        this.busy.set(false);
        this.generated.emit(shapes);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(messageFor(error));
      },
    });
  }
}

function messageFor(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 429) {
      return 'That was a lot of diagrams. Wait a minute and try again.';
    }

    const detail = (error.error as { detail?: string } | null)?.detail;
    if (detail) {
      return detail;
    }
  }

  return "Couldn't generate the diagram. Try again.";
}
