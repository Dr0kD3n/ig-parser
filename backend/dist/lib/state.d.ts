export interface ProfileData {
    url: string;
    name?: string;
    bio?: string;
    photo?: string;
    vote?: string;
    tg_status?: string;
}
export declare const StateManager: {
    processed: Set<string>;
    processedDonors: Set<string>;
    resultsCache: any[];
    init(): Promise<void>;
    has(url: string): boolean;
    add(url: string): Promise<void>;
    hasDonor(url: string): boolean;
    addDonor(url: string): Promise<void>;
    saveResult(profileData: ProfileData): Promise<void>;
    loadDonors(): Promise<string[]>;
    saveDonor(url: string): Promise<void>;
    saveDonors(urls: string[]): Promise<void>;
};
export declare const PATHS: {};
