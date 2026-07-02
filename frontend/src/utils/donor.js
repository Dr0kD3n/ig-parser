export const normalizeDonorUrl = (u) =>
  String(u || '')
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/[@/]/g, '')
    .trim();

export const getDonorUsername = (d) => {
  const url = typeof d === 'string' ? d : d.url;
  return url.replace('https://www.instagram.com/', '').replace(/[@/]/g, '').trim();
};
