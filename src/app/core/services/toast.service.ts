import { Injectable } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warn';

type ConfirmOpts = {
  message: string;
  type?: ToastType;
  okText?: string;
  cancelText?: string;
  timeoutMs?: number; // auto-cancel after N ms (optional)
};

type ToastHost = {
  show: (msg: string, type: ToastType) => void;
  showConfirm?: (opts: ConfirmOpts) => Promise<boolean>;
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  private host?: ToastHost;

  // Buffer for toasts fired BEFORE the container registers
  // (e.g. errors during app startup / first ngOnInit)
  private pendingToasts: Array<{ msg: string; type: ToastType }> = [];
  private pendingConfirms: Array<{ opts: ConfirmOpts; resolve: (v: boolean) => void }> = [];

  register(host: ToastHost): void {
    this.host = host;

    // Flush anything that was fired before the container mounted
    const toasts = [...this.pendingToasts];
    this.pendingToasts = [];
    toasts.forEach(t => host.show(t.msg, t.type));

    const confirms = [...this.pendingConfirms];
    this.pendingConfirms = [];
    confirms.forEach(c => {
      if (host.showConfirm) {
        host.showConfirm(c.opts).then(c.resolve);
      } else {
        c.resolve(window.confirm(c.opts.message));
      }
    });
  }

  private push(msg: string, type: ToastType): void {
    if (this.host) {
      this.host.show(msg, type);
    } else {
      // Container not mounted yet — buffer instead of dropping silently
      this.pendingToasts.push({ msg, type });
      console.warn('[ToastService] Toast buffered (container not registered yet):', type, msg);
    }
  }

  success(m: string) { this.push(m, 'success'); }
  error(m: string)   { this.push(m, 'error'); }
  info(m: string)    { this.push(m, 'info'); }
  warn(m: string)    { this.push(m, 'warn'); }

  /** Async confirm that resolves true/false without blocking. */
  confirm(opts: ConfirmOpts): Promise<boolean> {
    const normalized: ConfirmOpts = {
      message: opts.message,
      type: opts.type ?? 'warn',
      okText: opts.okText ?? 'OK',
      cancelText: opts.cancelText ?? 'Cancel',
      timeoutMs: opts.timeoutMs ?? 0,
    };

    if (this.host?.showConfirm) {
      return this.host.showConfirm(normalized);
    }

    // Container not mounted yet — queue the confirm; it will show
    // as soon as the container registers. (window.confirm is unreliable
    // in Electron: it can be suppressed and breaks keyboard focus.)
    console.warn('[ToastService] Confirm queued (container not registered yet):', normalized.message);
    return new Promise<boolean>((resolve) => {
      this.pendingConfirms.push({ opts: normalized, resolve });
    });
  }
}