"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFingerprint = generateFingerprint;
const UAs = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];
const REGIONAL_PROFILES = [
    { locale: 'en-US', timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'] },
    { locale: 'en-GB', timezones: ['Europe/London'] },
    { locale: 'ru-RU', timezones: ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Simferopol', 'Asia/Yekaterinburg'] },
    { locale: 'de-DE', timezones: ['Europe/Berlin'] },
    { locale: 'fr-FR', timezones: ['Europe/Paris'] },
    { locale: 'it-IT', timezones: ['Europe/Rome'] },
    { locale: 'es-ES', timezones: ['Europe/Madrid'] }
];

function generateFingerprint() {
    const ua = UAs[Math.floor(Math.random() * UAs.length)];
    const profile = REGIONAL_PROFILES[Math.floor(Math.random() * REGIONAL_PROFILES.length)];
    const timezone = profile.timezones[Math.floor(Math.random() * profile.timezones.length)];

    // Randomize viewport
    const width = 1280 + Math.floor(Math.random() * 300);
    const height = 720 + Math.floor(Math.random() * 200);

    // Device Scale Factor (mostly 1 or 2 for desktop)
    const deviceScaleFactor = Math.random() > 0.8 ? 2 : 1;

    return {
        userAgent: ua,
        viewport: { width, height },
        locale: profile.locale,
        timezoneId: timezone,
        deviceScaleFactor,
        isMobile: false,
        hasTouch: false
    };
}
