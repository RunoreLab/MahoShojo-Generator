// types/turnstile.d.ts
declare global {
  interface Window {
    turnstile: {
      render: (
        element: HTMLElement | string,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          theme?: 'light' | 'dark' | 'auto';
          language?: string;
          size?: 'normal' | 'flexible' | 'compact';
        }
      ) => string;
      remove: (element: HTMLElement | string) => void;
      reset: (element: HTMLElement | string) => void;
    };
  }

  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: string;
      TURNSTILE_SECRET_KEY: string;
    }
  }
}

export {};