const MODEL_PRICING_ALIASES = new Map([
  ['openai:gpt56', 'openai:gpt56sol'],
]);

export function normalizeModelPricingName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]/g, '');
}

export function calculateModelNameDistance(left, right) {
  if (left === right) {
    return 0;
  }
  if (!left.length || !right.length) {
    return Math.max(left.length, right.length);
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[right.length];
}

export function rankAivaxPricingModels(modelId, catalog, providerHint = '') {
  const rawTarget = String(modelId ?? '').trim().toLowerCase().replace(/^@/, '');
  const targetSlash = rawTarget.indexOf('/');
  const targetColon = providerHint ? -1 : rawTarget.indexOf(':');
  const targetSeparator = targetSlash >= 0 ? targetSlash : targetColon;
  const targetProvider = normalizeModelPricingName(
    providerHint || (targetSeparator >= 0 ? rawTarget.slice(0, targetSeparator) : ''),
  );
  const targetModel = normalizeModelPricingName(
    targetSeparator >= 0 ? rawTarget.slice(targetSeparator + 1) : rawTarget,
  );
  const targetFull = normalizeModelPricingName(rawTarget);
  const aliasedTarget = MODEL_PRICING_ALIASES.get(`${targetProvider}:${targetModel}`);

  return catalog
    .filter((candidate) => candidate?.name)
    .map((candidate) => {
      const rawCandidate = String(candidate.name).trim().toLowerCase().replace(/^@/, '');
      const candidateSlash = rawCandidate.indexOf('/');
      const candidateProvider = normalizeModelPricingName(
        candidateSlash >= 0 ? rawCandidate.slice(0, candidateSlash) : '',
      );
      const candidateModel = normalizeModelPricingName(
        candidateSlash >= 0 ? rawCandidate.slice(candidateSlash + 1) : rawCandidate,
      );
      const candidateFull = normalizeModelPricingName(rawCandidate);
      const modelDistance = calculateModelNameDistance(targetModel, candidateModel);
      const providerDistance = targetProvider
        ? calculateModelNameDistance(targetProvider, candidateProvider)
        : 0;

      return {
        candidate,
        exact: rawCandidate === rawTarget ? 1 : 0,
        normalizedFull: candidateFull === targetFull ? 1 : 0,
        alias: aliasedTarget === `${candidateProvider}:${candidateModel}` ? 1 : 0,
        sameProvider: targetProvider && candidateProvider === targetProvider ? 1 : 0,
        normalizedModel: candidateModel === targetModel ? 1 : 0,
        modelPrefix: candidateModel.startsWith(targetModel) || targetModel.startsWith(candidateModel)
          ? 1
          : 0,
        modelDistance,
        providerDistance,
      };
    })
    .sort((left, right) => (
      right.exact - left.exact
      || right.normalizedFull - left.normalizedFull
      || right.alias - left.alias
      || right.sameProvider - left.sameProvider
      || right.normalizedModel - left.normalizedModel
      || right.modelPrefix - left.modelPrefix
      || left.modelDistance - right.modelDistance
      || left.providerDistance - right.providerDistance
      || String(left.candidate.name).localeCompare(String(right.candidate.name))
    ))
    .map(({ candidate }) => candidate);
}
