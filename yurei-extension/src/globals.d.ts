import type { PageApi } from "./page-api";

declare global {
  interface Window {
    __yurei?: PageApi;
    __yureiIndicator?: true;
  }
}

export {};
