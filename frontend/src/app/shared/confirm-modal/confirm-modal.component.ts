import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (dialog(); as dlg) {
      <div class="modal-overlay confirm-overlay" (click)="cancel()">
        <div class="modal confirm-modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-header__titles">
              <span class="eyebrow">{{ dlg.eyebrow }}</span>
              <h2>{{ dlg.title }}</h2>
            </div>
            <button
              class="icon-close-btn"
              type="button"
              (click)="cancel()"
              aria-label="Закрити"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <p class="confirm-message">{{ dlg.message }}</p>

          <hr class="modal-divider" />

          <div class="modal-footer">
            <div class="modal-footer__right">
              <button type="button" class="btn btn--secondary" (click)="cancel()">
                {{ dlg.cancelLabel }}
              </button>
              <button
                type="button"
                class="btn"
                [class.btn--danger]="dlg.danger"
                [class.btn--primary]="!dlg.danger"
                (click)="confirm()"
              >
                {{ dlg.confirmLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .confirm-overlay {
      z-index: 1200;
    }

    .confirm-modal {
      max-width: 440px;
    }

    .confirm-message {
      font-size: 0.9375rem;
      color: var(--ink-secondary);
      line-height: 1.55;
    }
  `],
})
export class ConfirmModalComponent {
  private readonly confirmService = inject(ConfirmDialogService);
  readonly dialog = this.confirmService.activeDialog;

  confirm(): void {
    this.confirmService.respond(true);
  }

  cancel(): void {
    this.confirmService.respond(false);
  }
}
