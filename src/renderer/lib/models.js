export const intelligenceLevelLimits = Object.freeze({ min: 3, max: 10 });

const fastModelNamePattern = /(?:\(\s*fast\s*\)|\s-\s*fast\b)\s*/gi;

export function splitFastModelName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  const stripped = value.replace(fastModelNamePattern, ' ').replace(/\s{2,}/g, ' ').trim();
  return { name: stripped || value, isFast: Boolean(value) && stripped !== value };
}

export function titleCaseEffort(effort) {
  return typeof effort === 'string' && effort
    ? effort[0].toUpperCase() + effort.slice(1)
    : effort;
}
