'use strict';

/** E2E-стаб: имитирует фарм профилей (5 шт.) без Instagram */
const state = require('../lib/state');

const PROFILE_COUNT = 5;

async function main() {
  await state.StateManager.init();

  const donors = await state.StateManager.loadDonors();
  if (!donors.length) {
    throw new Error('Нет доноров для фарма профилей — сначала запустите фарм доноров');
  }

  const primaryDonor = donors[0];
  const donorHandle = primaryDonor.url.split('/').filter(Boolean).pop() || 'e2e_donor';

  for (let i = 1; i <= PROFILE_COUNT; i++) {
    const username = `e2e_profile_${i}`;
    const profile = {
      url: `https://www.instagram.com/${username}/`,
      username,
      name: `E2E Profile ${i}`,
      bio: `E2E test profile #${i}`,
      donor: `@${donorHandle}`,
      followers_count: 500 + i * 10,
      publications_count: 10 + i,
      posts_count: 10 + i,
      isInCity: 0,
    };

    console.log(`🏆 [E2E-INDEX] Сохраняем профиль: ${profile.name}`);
    await state.StateManager.saveResult(profile);
    await state.StateManager.add(profile.url);
  }

  console.log(`✅ [E2E-INDEX] Фарм профилей завершён: ${PROFILE_COUNT} профилей`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`❌ [E2E-INDEX] ${err.message}`);
    process.exit(1);
  });
