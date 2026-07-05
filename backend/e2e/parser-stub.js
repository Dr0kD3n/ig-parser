'use strict';

/** E2E-стаб: имитирует фарм доноров без Instagram */
const state = require('../lib/state');

const E2E_DONORS = [
  {
    url: 'https://www.instagram.com/e2e_donor_alpha/',
    username: 'e2e_donor_alpha',
    name: 'E2E Donor Alpha',
    bio: 'e2e donor alpha bio',
    followers_count: 1200,
    publications_count: 45,
    posts_count: 45,
  },
  {
    url: 'https://www.instagram.com/e2e_donor_beta/',
    username: 'e2e_donor_beta',
    name: 'E2E Donor Beta',
    bio: 'e2e donor beta bio',
    followers_count: 800,
    publications_count: 30,
    posts_count: 30,
  },
];

async function main() {
  await state.StateManager.init();

  for (const donor of E2E_DONORS) {
    console.log(`🔍 [E2E-PARSER] Найден донор: ${donor.username}`);
    await state.StateManager.saveDonor(donor.url, 'e2e', 'TestCity', 'e2e-niche');
    await state.StateManager.saveDonorInfo({
      ...donor,
      photo: '',
      photo_local: '',
      photo_status: 'missing',
    });
    await state.StateManager.addDonor(donor.url);
  }

  console.log(`✅ [E2E-PARSER] Фарм доноров завершён: ${E2E_DONORS.length} доноров`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`❌ [E2E-PARSER] ${err.message}`);
    process.exit(1);
  });
