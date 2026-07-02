/** Фильтрация профилей в ProfilesTab */
export function filterProfiles(girls, options) {
  const {
    votes,
    filterText,
    filterStatus,
    filterTgStatus,
    followersMin,
    followersMax,
    hideViewed,
    hideNoImage,
    cityOnly,
    filterDonor,
    failedImages,
    matchesProfileCity,
    matchesWordsBlacklist,
  } = options;

  const query = filterText.toLowerCase();
  const minFollowers = followersMin === '' ? null : Number(followersMin);
  const maxFollowers = followersMax === '' ? null : Number(followersMax);

  return girls
    .filter((g) => !matchesWordsBlacklist || !matchesWordsBlacklist(g))
    .filter((g) => {
      const matchesName = g.name.toLowerCase().includes(query);

      let matchesStatus = false;
      if (filterStatus === 'all') matchesStatus = true;
      else if (filterStatus === 'unopened') matchesStatus = !g.viewed;
      else if (filterStatus === 'like') matchesStatus = votes[g.url] === 'like';
      else if (filterStatus === 'like_no_dm') matchesStatus = votes[g.url] === 'like' && !g.dmSent;
      else if (filterStatus === 'dislike') matchesStatus = votes[g.url] === 'dislike';
      else if (filterStatus === 'no_status') matchesStatus = !votes[g.url];
      else if (filterStatus === 'active') matchesStatus = votes[g.url] !== 'dislike';
      else if (filterStatus === 'dm_sent') matchesStatus = g.dmSent;
      else if (filterStatus === 'replied') matchesStatus = g.dm_status === 'replied';
      else if (filterStatus === 'liked') matchesStatus = g.dm_status === 'liked' || votes[g.url] === 'like';

      let matchesTg = true;
      if (filterTgStatus === 'yes') matchesTg = g.tg_status === 'valid';
      else if (filterTgStatus === 'none') matchesTg = !g.tg_status;

      const followersCount = Number(g.followers_count || 0);
      const matchesFollowers =
        (minFollowers === null || followersCount >= minFollowers) &&
        (maxFollowers === null || followersCount <= maxFollowers);

      const matchesViewed = !hideViewed || !g.viewed;
      const matchesCity = !cityOnly || (matchesProfileCity ? matchesProfileCity(g) : g.isInCity);
      const imgOk = !hideNoImage || ((g.photo_local || g.photo) && !failedImages.has(g.url));
      const matchesDonor = filterDonor === 'all' || g.donor === filterDonor;

      return (
        matchesName &&
        matchesStatus &&
        matchesTg &&
        matchesFollowers &&
        matchesViewed &&
        matchesCity &&
        imgOk &&
        matchesDonor
      );
    });
}
