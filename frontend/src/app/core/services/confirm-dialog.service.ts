import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  eyebrow?: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ActiveConfirmDialog extends ConfirmDialogOptions {
  resolve: (value: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly activeDialog = signal<ActiveConfirmDialog | null>(null);

  open(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.activeDialog.set({
        eyebrow: options.eyebrow ?? 'ПІДТВЕРДЖЕННЯ ДІЇ',
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Підтвердити',
        cancelLabel: options.cancelLabel ?? 'Скасувати',
        danger: options.danger ?? false,
        resolve,
      });
    });
  }

  respond(result: boolean): void {
    const current = this.activeDialog();
    if (!current) return;
    this.activeDialog.set(null);
    current.resolve(result);
  }
}
