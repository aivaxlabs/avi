import {
  AudioLines,
  Brain,
  Box,
  Image,
  RefreshCw,
  Search,
  Star,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { classNames, formatPrice } from '../lib/format.js';

const tabs = ['Favorites', 'Models', 'AI Gateways'];
const intelligenceOrder = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];
const speedOrder = ['Slowest', 'Slow', 'Medium', 'Fast', 'Ultrafast'];
const priceRanges = [
  { id: 'cheapest', label: 'Cheapest', max: 0.5 },
  { id: 'cheap', label: 'Cheap', max: 1 },
  { id: 'mid-range', label: 'Mid Range', max: 4 },
  { id: 'costly', label: 'Costly', max: 15 },
  { id: 'expensive', label: 'Expensive', min: 15 },
];

export function ModelPicker({
  models,
  favorites,
  currentModel,
  onClose,
  onChoose,
  onToggleFavorite,
  onRefresh,
}) {
  const [tab, setTab] = useState(() => favorites.length > 0 ? 'Favorites' : 'Models');
  const [query, setQuery] = useState('');
  const [speedFilter, setSpeedFilter] = useState('');
  const [intelligenceFilter, setIntelligenceFilter] = useState('');
  const [priceFilter, setPriceFilter] = useState('');
  const [selectedModelId, setSelectedModelId] = useState(currentModel);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);

  const tabModels = useMemo(() => models.filter((model) => {
    if (tab === 'Favorites' && !favorites.includes(model.id)) return false;
    if (tab === 'Models' && !model.routed) return false;
    if (tab === 'AI Gateways' && model.routed) return false;
    return true;
  }), [favorites, models, tab]);

  const filterOptions = useMemo(() => {
    const options = {
      speed: new Set(),
      intelligence: new Set(),
    };

    for (const model of tabModels) {
      const values = modelFilterValues(model, modelsById);
      if (values.speed) options.speed.add(values.speed);
      if (values.intelligence) options.intelligence.add(values.intelligence);
    }

    return {
      speed: [...options.speed].sort((a, b) => compareByOrder(a, b, speedOrder)),
      intelligence: [...options.intelligence].sort((a, b) => compareByOrder(a, b, intelligenceOrder)),
    };
  }, [modelsById, tabModels]);

  const groupedModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const visibleModels = tabModels
      .filter((model) => {
        const values = modelFilterValues(model, modelsById);
        if (speedFilter && values.speed !== speedFilter) return false;
        if (intelligenceFilter && values.intelligence !== intelligenceFilter) return false;
        if (priceFilter && values.priceRange !== priceFilter) return false;
        if (!normalized) return true;
        return `${model.id} ${model.name} ${model.description} ${model.provider} ${sourceModelName(model)}`
          .toLowerCase()
          .includes(normalized);
      });

    if (tab === 'AI Gateways') {
      return [{
        provider: 'AI Gateways',
        providerKey: 'AI Gateway',
        showHeader: false,
        items: [...visibleModels].sort(compareModelsByName),
      }];
    }

    return groupByProvider(visibleModels, modelsById);
  }, [
    intelligenceFilter,
    modelsById,
    priceFilter,
    query,
    speedFilter,
    tab,
    tabModels,
  ]);

  const visibleCount = groupedModels.reduce((total, group) => total + group.items.length, 0);
  const visibleModels = groupedModels.flatMap((group) => group.items);
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) ?? visibleModels[0] ?? null;
  const selectedDetails = selectedModel ? modelDetails(selectedModel, modelsById) : null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="model-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Choose model</h2>
            <p>Choose the model you want to use from the integrated inference.</p>
          </div>
          <div className="dialog-header-actions">
            <button className="icon-button tiny" type="button" onClick={onRefresh} aria-label="Refresh models">
              <RefreshCw size={15} />
            </button>
            <button className="icon-button tiny" type="button" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="model-filters">
          <label>
            <span>Filter</span>
            <div className="model-filter-input">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter models..." />
            </div>
          </label>
          <label>
            <span>Provider</span>
            <div className="model-provider-tabs">
              {tabs.map((item) => (
                <button
                  key={item}
                  className={classNames(tab === item && 'active')}
                  type="button"
                  onClick={() => setTab(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>Speed</span>
            <select value={speedFilter} onChange={(event) => setSpeedFilter(event.target.value)}>
              <option value="">All speeds</option>
              {filterOptions.speed.map((speed) => (
                <option key={speed} value={speed}>{speed}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Intelligence</span>
            <select value={intelligenceFilter} onChange={(event) => setIntelligenceFilter(event.target.value)}>
              <option value="">All intelligences</option>
              {filterOptions.intelligence.map((intelligence) => (
                <option key={intelligence} value={intelligence}>{intelligence}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Price</span>
            <select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value)}>
              <option value="">All prices</option>
              {priceRanges.map((price) => (
                <option key={price.id} value={price.id}>{price.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="model-table-wrap">
          <div className="model-table">
            {groupedModels.map((group) => (
              <section key={group.provider} className="model-provider-group">
              {group.showHeader !== false && (
                <h3>
                  <ProviderIcon provider={group.providerKey} size="small" />
                  <span>{group.provider}</span>
                </h3>
              )}
              {group.items.map((model) => {
                const details = modelDetails(model, modelsById);
                const nameParts = modelNameParts(model);
                return (
                  <article
                    key={model.id}
                    className={classNames(
                      'model-row',
                      selectedModel?.id === model.id && 'active',
                    )}
                  >
                    <button
                      className="model-row-content"
                      type="button"
                      onClick={() => {
                        setSelectedModelId(model.id);
                      }}
                      onDoubleClick={() => {
                        onChoose(model.id);
                        onClose();
                      }}
                    >
                      <strong>
                        {nameParts.base}
                        {nameParts.suffix && <small>{nameParts.suffix}</small>}
                      </strong>
                      <span>{capabilityIcons(details.capabilities)}</span>
                      <span>{details.speed ?? '-'}</span>
                      <span>{details.intelligence ?? '-'}</span>
                      <span>{formatContextPair(model, details, modelsById)}</span>
                      <span>{formatPricePair(details.pricing)}</span>
                    </button>
                    <button
                      className={classNames('favorite-button', favorites.includes(model.id) && 'active')}
                      type="button"
                      onClick={() => onToggleFavorite(model.id)}
                      aria-label={favorites.includes(model.id) ? 'Remove favorite' : 'Add favorite'}
                    >
                      <Star size={16} />
                    </button>
                  </article>
                );
              })}
              </section>
            ))}
            {visibleCount === 0 && <div className="empty-list">No models here yet.</div>}
          </div>
          {selectedModel && selectedDetails && (
            <SelectedModelDetails
              details={selectedDetails}
              model={selectedModel}
              modelsById={modelsById}
            />
          )}
        </div>
        <footer className="dialog-footer model-dialog-footer">
          <span>{visibleCount} models</span>
          <div>
            <button type="button" className="primary-mini" disabled={!selectedModel} onClick={() => {
              if (!selectedModel) return;
              onChoose(selectedModel.id);
              onClose();
            }}>
              OK
            </button>
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SelectedModelDetails({ details, model, modelsById }) {
  const providerKey = providerKeyFromModel(model);
  const nameParts = modelNameParts(model);

  return (
    <section className="selected-model-details">
      <div className="selected-model-heading">
        <ProviderIcon provider={providerKey} />
        <div>
          <span>{providerLabel(providerKey)}</span>
          <strong>
            {nameParts.base}
            {nameParts.suffix && <small>{nameParts.suffix}</small>}
          </strong>
        </div>
        <div className="selected-model-tools">
          {detailTool('Audio input', <AudioLines size={15} />)}
          {detailTool('Image input', <Image size={15} />)}
          {detailTool('Video input', <Video size={15} />)}
          {detailTool('Reasoning', <Brain size={15} />)}
          {detailTool('Tool calling', <Wrench size={15} />)}
        </div>
      </div>
      <div className="selected-model-body">
        <p>{details.description || 'No description available for this model.'}</p>
        <dl>
          <div><dt>Intelligence level</dt><dd>{details.intelligence ?? '-'}</dd></div>
          <div><dt>Speed</dt><dd>{details.speed ?? '-'}</dd></div>
          <div><dt>Max output tokens</dt><dd>{formatCount(details.maxOutputTokens)}</dd></div>
          <div><dt>Context window</dt><dd>{formatContextPair(model, details, modelsById)}</dd></div>
          <div><dt>Provider</dt><dd>{providerLabel(providerKey)}</dd></div>
          <div><dt>Input price</dt><dd>{formatPrice(details.pricing.input)} / m tokens</dd></div>
          <div><dt>Cached input price</dt><dd>{formatPrice(details.pricing.cached)} / m tokens</dd></div>
          <div><dt>Output price</dt><dd>{formatPrice(details.pricing.output)} / m tokens</dd></div>
        </dl>
      </div>
    </section>
  );
}

function ProviderIcon({ provider, size = 'large' }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [provider]);

  if (failed) {
    return (
      <span className={classNames('provider-fallback-icon', size === 'small' && 'small')}>
        <Box size={size === 'small' ? 12 : 22} />
      </span>
    );
  }

  return <img src={providerIconUrl(provider)} alt="" onError={() => setFailed(true)} />;
}

function groupByProvider(models, modelsById) {
  const groups = new Map();

  for (const model of models) {
    const providerKey = providerKeyFromModel(model);
    const provider = providerLabel(providerKey);
    const current = groups.get(providerKey) ?? { providerKey, provider, items: [] };
    groups.set(providerKey, {
      ...current,
      items: [...current.items, model],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => compareModelsByReleaseDate(a, b, modelsById)),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function compareModelsByReleaseDate(a, b, modelsById) {
  const aTime = releaseDateTime(a, modelsById);
  const bTime = releaseDateTime(b, modelsById);

  if (aTime !== bTime) return bTime - aTime;

  return compareModelsByName(a, b);
}

function compareModelsByName(a, b) {
  return (a.name || a.id).localeCompare(b.name || b.id);
}

function compareText(a, b) {
  return a.localeCompare(b);
}

function compareByOrder(a, b, order) {
  const aIndex = order.findIndex((item) => item.toLowerCase() === String(a).toLowerCase());
  const bIndex = order.findIndex((item) => item.toLowerCase() === String(b).toLowerCase());

  if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
  if (aIndex >= 0) return -1;
  if (bIndex >= 0) return 1;
  return compareText(a, b);
}

function releaseDateTime(model, modelsById) {
  const baseModel = baseModelFor(model, modelsById);
  const value = baseModel.releaseDate ?? baseModel._details?.provider_model?.release_date ?? null;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function providerKeyFromModel(model) {
  return model.provider || providerFromId(model.routed ? model.id : sourceModelName(model));
}

function providerLabel(provider) {
  return String(provider)
    .split('-')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function providerIconUrl(provider) {
  return `https://console.aivax.net/assets/providers/${encodeURIComponent(String(provider).replace(/^@/, ''))}.svg`;
}

function providerFromId(value) {
  const match = String(value ?? '').match(/^@([^/]+)\//);
  return match?.[1] ?? 'AI Gateway';
}

function modelDetails(model, modelsById) {
  const baseModel = baseModelFor(model, modelsById);
  const providerModel = baseModel._details?.provider_model ?? {};
  const firstPricing = Array.isArray(providerModel.pricing) ? providerModel.pricing[0] ?? {} : {};
  const technicalInfo = providerModel.technical_info ?? {};

  return {
    description: firstText(baseModel.description, providerModel.description),
    pricing: {
      input: baseModel.pricing?.input ?? firstPricing.input_mtokens ?? null,
      output: baseModel.pricing?.output ?? firstPricing.output_mtokens ?? null,
      cached: baseModel.pricing?.cached ?? firstPricing.input_cache_mtokens ?? null,
    },
    speed: baseModel.speed ?? technicalInfo.speed ?? null,
    intelligence: baseModel.intelligence ?? technicalInfo.intelligence ?? null,
    contextWindow: baseModel.contextWindow ?? technicalInfo.context_window ?? null,
    maxOutputTokens: baseModel.maxOutputTokens ?? technicalInfo.max_output_tokens ?? null,
    capabilities: Array.isArray(baseModel.capabilities)
      ? baseModel.capabilities
      : Array.isArray(providerModel.capabilities)
        ? providerModel.capabilities
        : [],
  };
}

function capabilityIcons(capabilities) {
  const labels = new Set(capabilities.map((capability) => String(capability).toLowerCase()));

  return (
    <>
      {labels.has('audioinput') && <AudioLines size={14} />}
      {labels.has('imageinput') && <Image size={14} />}
      {labels.has('videoinput') && <Video size={14} />}
      {labels.has('thinking') && <Brain size={14} />}
      {labels.has('toolcalling') && <Wrench size={14} />}
    </>
  );
}

function detailTool(label, icon) {
  return (
    <span title={label}>
      {icon}
      <small>{label}</small>
    </span>
  );
}

function modelFilterValues(model, modelsById) {
  const details = modelDetails(model, modelsById);

  return {
    speed: details.speed ?? '',
    intelligence: details.intelligence ?? '',
    priceRange: priceRangeId(details.pricing.output),
  };
}

function priceRangeId(outputPrice) {
  const price = Number(outputPrice);
  if (!Number.isFinite(price)) return '';

  return priceRanges.find((range) => {
    if (range.min !== undefined) return price > range.min;
    return price <= range.max;
  })?.id ?? '';
}

function formatPricePair(pricing) {
  return `${formatPrice(pricing.input)} / ${formatPrice(pricing.output)}`;
}

function formatContextPair(model, details, modelsById) {
  const base = baseModelFor(model, modelsById);
  const sourceContext = details.contextWindow;
  const routedContext = model.routed ? model.contextWindow ?? model._details?.ai_gateway?.context_window : null;

  if (routedContext && routedContext !== sourceContext) {
    return `${formatShortCount(sourceContext)} -> ${formatShortCount(routedContext)}`;
  }

  return formatShortCount(sourceContext ?? base.contextWindow);
}

function modelNameParts(model) {
  const name = model.name || model.id;
  if (model.routed) return { base: name, suffix: '' };

  const separator = name.indexOf(':');
  if (separator < 0) return { base: name, suffix: '' };

  return {
    base: name.slice(0, separator),
    suffix: name.slice(separator),
  };
}

function modelLabel(model) {
  return model.routed ? model.id : sourceModelName(model) ?? model.id;
}

function baseModelFor(model, modelsById) {
  return model.routed ? model : modelsById.get(sourceModelName(model)) ?? model;
}

function sourceModelName(model) {
  return model.sourceModel ?? model._details?.ai_gateway?.model_name ?? null;
}

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? '';
}

function formatCount(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString();
}

function formatShortCount(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number >= 1_000_000) return `${trimNumber(number / 1_000_000)}M`;
  if (number >= 1_000) return `${trimNumber(number / 1_000)}K`;
  return number.toLocaleString();
}

function trimNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}
