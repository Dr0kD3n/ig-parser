export interface Account {
    id: string;
    name: string;
    proxy: string;
    cookies: string;
    fingerprint?: string | any;
}

export interface SettingsData {
    accounts: Account[];
    activeParserAccountIds: string[];
    activeServerAccountIds: string[];
    activeIndexAccountIds: string[];
    activeProfilesAccountIds: string[];
    names: string[];
    cities: string[];
    niches: string[];
    donors: string[];
    showBrowser: boolean;
    concurrentProfiles?: number;
}

export interface Girl {
    url: string;
    name: string;
    bio: string;
    photo: string;
    timestamp: string;
    vote?: string;
    tg_status?: string;
    viewed?: boolean;
    dmSent?: boolean;
    status?: string;
}

export interface BotStatus {
    index: boolean;
    parser: boolean;
    checker: boolean;
}

export interface LogEntry {
    id: string;
    timestamp: string;
    source: string;
    message: string;
    sessionId: string;
}
