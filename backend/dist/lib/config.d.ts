export declare const getConfigPath: (fileName: string) => string;
export declare const normalizeUrl: (url: string) => string;
export interface ProxyConfig {
    server: string;
    username: string;
    password: string;
}
export declare function getProxy(type?: string): Promise<ProxyConfig | null>;
export interface Cookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    sameSite: 'None' | 'Lax' | 'Strict';
}
export declare function getCookies(type?: string): Promise<Cookie[]>;
export declare function getList(fileName: string): Promise<string[]>;
export declare function getSetting<T = any>(key: string): Promise<T | null>;
export interface AccountInfo {
    proxy: ProxyConfig | null;
    cookies: Cookie[];
    fingerprint: any | null;
}
export declare function getAllAccounts(type?: string): Promise<AccountInfo[]>;
