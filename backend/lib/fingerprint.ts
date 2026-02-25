export interface Fingerprint {
    userAgent: string;
    viewport: { width: number; height: number };
    locale: string;
    timezoneId: string;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
}

const UAs: string[] = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0'
];

const locales: string[] = ['en-US', 'en-GB', 'ru-RU', 'de-DE', 'fr-FR'];
const timezones: string[] = ['America/New_York', 'Europe/London', 'Europe/Moscow', 'Europe/Berlin', 'Europe/Paris', 'Asia/Dubai'];

export function generateFingerprint(): Fingerprint {
    const ua = UAs[Math.floor(Math.random() * UAs.length)];
    const locale = locales[Math.floor(Math.random() * locales.length)];
    const timezone = timezones[Math.floor(Math.random() * timezones.length)];

    // Randomize viewport
    const width = 1200 + Math.floor(Math.random() * 400);
    const height = 800 + Math.floor(Math.random() * 200);

    // Device Scale Factor (mostly 1 or 2 for desktop)
    const deviceScaleFactor = Math.random() > 0.7 ? 2 : 1;

    return {
        userAgent: ua,
        viewport: { width, height },
        locale,
        timezoneId: timezone,
        deviceScaleFactor,
        isMobile: false,
        hasTouch: false
    };
}
