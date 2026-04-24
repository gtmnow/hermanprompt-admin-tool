/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_LAUNCH_PARAM?: string;
  readonly VITE_AUTH_LOGIN_URL?: string;
  readonly VITE_DEV_ADMIN_USER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
