import 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    lerzoSkipLoader?: boolean;
    lerzoLoaderTracked?: boolean;
  }
}
