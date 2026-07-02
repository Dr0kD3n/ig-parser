export const DEFAULT_SETTINGS = {
  accounts: [],
  activeParserAccountIds: [],
  activeServerAccountIds: [],
  activeIndexAccountIds: [],
  activeProfilesAccountIds: [],
  names: [],
  cities: [],
  citiesBlacklist: [],
  wordsBlacklist: [],
  niches: [],
  donors: [],
  showBrowser: false,
  humanEmulation: false,
  concurrentProfiles: 3,
  dmLimit: 20,
  donorGroups: [],
};

export const LOG_BUFFER = 200;

export const TABS = [
  { id: 'profiles', label: 'Профили' },
  { id: 'controls', label: 'Управление' },
  { id: 'settings', label: 'Настройки' },
  { id: 'stats', label: 'Сообщения' },
];
