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
  donorGroups: [{ id: 'all', type: 'all', name: 'Все доноры', messages: [] }],
};

export const LOG_BUFFER = 200;

export const TABS = [
  { id: 'profiles', label: 'Профили' },
  { id: 'controls', label: 'Управление' },
  { id: 'settings', label: 'Настройки' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'stats', label: 'Сообщения' },
];
