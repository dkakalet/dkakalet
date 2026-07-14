export const todayStr = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const round = (n, p = 1) => { const f = 10 ** p; return Math.round(n * f) / f; };
