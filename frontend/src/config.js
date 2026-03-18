// API bases
const IS_PROD = import.meta.env.PROD;
const PROD_URL = 'https://botback-production-1011.up.railway.app';

export const API_BASE = IS_PROD
  ? PROD_URL
  : (import.meta.env.VITE_AUTH_URL || PROD_URL);

export const LOCAL_API_BASE = '';

