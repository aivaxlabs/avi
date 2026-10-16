export const PLUGIN_API_VERSION = 2;
export const MIN_PLUGIN_API_VERSION = 2;

export function definePlugin(plugin) {
  return plugin;
}

export const pluginApi = Object.freeze({
  apiVersion: PLUGIN_API_VERSION,
  minApiVersion: MIN_PLUGIN_API_VERSION,
  definePlugin,
});
