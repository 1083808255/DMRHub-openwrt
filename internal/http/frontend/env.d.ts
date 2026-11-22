/// <reference types="vite/client" />

import type {
  RouteLocationNormalizedLoaded,
  Router,
} from 'vue-router';
import type { Composer } from 'vue-i18n';

type ToastPayload = {
  severity?: string;
  summary?: string;
  detail?: string;
  life?: number;
  sticky?: boolean;
};

type ConfirmPayload = {
  header?: string;
  message?: string;
  icon?: string;
  rejectClass?: string;
  rejectLabel?: string;
  acceptClass?: string;
  accept?: () => void;
  reject?: () => void;
};

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $t: Composer['t'];
    $te: Composer['te'];
    $router: Router;
    $route: RouteLocationNormalizedLoaded;
    $toast: {
      add: (options?: ToastPayload) => void;
      removeAllGroups: () => void;
    };
    $confirm: {
      require: (options?: ConfirmPayload) => void;
    };
  }
}
