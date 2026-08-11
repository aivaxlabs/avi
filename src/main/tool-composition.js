export function composeToolsWithPlugins(coreTools, pluginTools, extensionTools) {
  const reservedNames = new Set(
    [...coreTools, ...extensionTools].map((tool) => String(tool?.name ?? '')),
  );
  return [
    ...coreTools,
    ...pluginTools.filter((tool) => !reservedNames.has(String(tool?.name ?? ''))),
    ...extensionTools,
  ];
}
