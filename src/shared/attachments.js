export const attachmentContentSizeLimit = 20 * 1024 * 1024;

export const defaultMediaSizeLimit = 10 * 1024 * 1024;

export const mediaSizeLimitOptions = Object.freeze([
  { value: 5 * 1024 * 1024, label: '5 MB' },
  { value: 10 * 1024 * 1024, label: '10 MB' },
  { value: 20 * 1024 * 1024, label: '20 MB' },
  { value: 100 * 1024 * 1024, label: '100 MB' },
  { value: null, label: 'No limit' },
]);

export function effectiveMediaSizeLimit(model, tuning) {
  if (model?.mediaSizeLimit !== undefined) return model.mediaSizeLimit;
  return tuning?.mediaSizeLimit !== undefined ? tuning.mediaSizeLimit : defaultMediaSizeLimit;
}
