// src/types/electron.d.ts
export {};

declare global {
  interface Printer {
    name: string;
    isDefault?: boolean;
    status?: number | string;
    options?: Record<string, unknown>;
    description?: string;
  }

  interface PrintResult {
    ok: boolean;
    error?: string;
  }

  interface CanonPrintOptions {
    landscape?: boolean;
    copies?: number; // number of copies to print
  }

  interface CitizenPrintOptions {
    copies?: number; // number of copies to print
  }

  interface Window {
    electron?: {
      /** Print an A4 invoice to Canon (expects a data: URL of HTML) */
      printCanonA4: (dataUrl: string, opts?: CanonPrintOptions) => Promise<PrintResult>;

      /** Print a 50mm label to Citizen (expects a data: URL of HTML) */
      printCitizen50: (dataUrl: string, opts?: CitizenPrintOptions) => Promise<PrintResult>;

      /** Get available printers from main */
      listPrinters: () => Promise<Printer[]>;

      /** Gently nudge focus back to the app after printing */
      refocusHard: () => Promise<void>;
    };
  }
}