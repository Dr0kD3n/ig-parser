import { useEffect, useState } from 'react';
import { safeStorage } from '../utils/storage';

/** Набор фильтров профилей с автосохранением */
export function usePersistedFilters() {
  const [filterText, setFilterText] = useState(() => safeStorage.getItem('ig_filter_text', ''));
  const [filterStatus, setFilterStatus] = useState(() => safeStorage.getItem('ig_filter_status', 'all'));
  const [filterTgStatus, setFilterTgStatus] = useState(() => safeStorage.getItem('ig_filter_tg', 'all'));
  const [hideNoImage, setHideNoImage] = useState(() => safeStorage.getItem('ig_hide_no_img') === 'true');
  const [hideViewed, setHideViewed] = useState(() => safeStorage.getItem('ig_hide_viewed') === 'true');
  const [filterDonorCategories, setFilterDonorCategories] = useState(() => {
    const saved = safeStorage.parse('ig_filter_donor_categories', []);
    return Array.isArray(saved) ? saved.filter((value) => typeof value === 'string') : [];
  });
  const [followersMin, setFollowersMin] = useState(() => safeStorage.getItem('ig_followers_min', ''));
  const [followersMax, setFollowersMax] = useState(() => safeStorage.getItem('ig_followers_max', ''));

  useEffect(() => {
    safeStorage.setItem('ig_filter_text', filterText);
    safeStorage.setItem('ig_filter_status', filterStatus);
    safeStorage.setItem('ig_filter_tg', filterTgStatus);
    safeStorage.setItem('ig_hide_no_img', String(hideNoImage));
    safeStorage.setItem('ig_hide_viewed', String(hideViewed));
    safeStorage.setItem('ig_filter_donor_categories', JSON.stringify(filterDonorCategories));
    safeStorage.setItem('ig_followers_min', followersMin);
    safeStorage.setItem('ig_followers_max', followersMax);
  }, [
    filterText,
    filterStatus,
    filterTgStatus,
    hideNoImage,
    hideViewed,
    filterDonorCategories,
    followersMin,
    followersMax,
  ]);

  return {
    filterText,
    setFilterText,
    filterStatus,
    setFilterStatus,
    filterTgStatus,
    setFilterTgStatus,
    hideNoImage,
    setHideNoImage,
    hideViewed,
    setHideViewed,
    filterDonorCategories,
    setFilterDonorCategories,
    followersMin,
    setFollowersMin,
    followersMax,
    setFollowersMax,
  };
}
