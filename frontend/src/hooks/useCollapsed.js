import { useState, useEffect } from 'react';
import { safeStorage } from '../utils/storage';

/** Сворачиваемая секция с сохранением в localStorage */
export function useCollapsed(key, defaultVal = false) {
  const [collapsed, setCollapsed] = useState(() => safeStorage.parse(key, defaultVal));

  useEffect(() => {
    safeStorage.setItem(key, JSON.stringify(collapsed));
  }, [key, collapsed]);

  const toggle = () => setCollapsed((c) => !c);
  return [collapsed, toggle];
}
