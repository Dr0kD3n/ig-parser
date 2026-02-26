export interface Fingerprint {
    userAgent: string;
    viewport: {
        width: number;
        height: number;
    };
    locale: string;
    timezoneId: string;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
}
export declare function generateFingerprint(): Fingerprint;
