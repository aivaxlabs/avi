import { RefreshCw, Search, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { classNames, formatPrice } from '../lib/format.js';

const tabs = ['Favorites', 'Models', 'AI Gateways'];

export function ModelPicker({
  models,
  favorites,
  currentModel,
  onClose,
  onChoose,
  onToggleFavorite,
  onRefresh,
}) {
  const [tab, setTab] = useState('Models');
  const [query, setQuery] = useState('');

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);

  const groupedModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const visibleModels = models
      .filter((model) => {
        if (tab === 'Favorites' && !favorites.includes(model.id)) return false;
        if (tab === 'Models' && !model.routed) return false;
        if (tab === 'AI Gateways' && model.routed) return false;
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
  }, [favorites, models, modelsById, query, tab]);

  const visibleCount = groupedModels.reduce((total, group) => total + group.items.length, 0);

  return (
    <section className="model-popover" onMouseDown={(event) => event.stopPropagation()}>
      <div className="model-popover-header">
        <div>
          <h2>Choose model</h2>
          <p>Models and AI gateways grouped by provider.</p>
        </div>
        <button className="icon-button tiny" type="button" onClick={onRefresh} aria-label="Refresh models">
          <RefreshCw size={15} />
        </button>
      </div>
      <label className="dialog-search model-popover-search">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" />
      </label>
      <div className="tabs">
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
      <div className="model-list">
        {groupedModels.map((group) => (
          <section key={group.provider} className="model-provider-group">
            {group.showHeader !== false && (
              <h3>
                <img src={providerIconUrl(group.providerKey)} alt="" />
                <span>{group.provider}</span>
              </h3>
            )}
            {group.items.map((model) => {
              const details = modelDetails(model, modelsById);
              const nameParts = modelNameParts(model);
              return (
              <article key={model.id} className={classNames('model-card', currentModel === model.id && 'active')}>
                <button
                  className="model-content"
                  type="button"
                  onClick={() => {
                    onChoose(model.id);
                    onClose();
                  }}
                >
                  <div>
                    <h4>
                      {nameParts.base}
                      {nameParts.suffix && <small>{nameParts.suffix}</small>}
                    </h4>
                    <span>{modelLabel(model)}</span>
                  </div>
                  {details.description && <p>{details.description}</p>}
                  <div className="model-meta">
                    <span>In {formatPrice(details.pricing.input)}</span>
                    <span>Out {formatPrice(details.pricing.output)}</span>
                    <span>Cached {formatPrice(details.pricing.cached)}</span>
                    <span>Speed {details.speed ?? '-'}</span>
                    <span>IQ {details.intelligence ?? '-'}</span>
                    <span>Context {formatCount(details.contextWindow)}</span>
                  </div>
                  {details.capabilities.length > 0 && (
                    <div className="model-capabilities">
                      {details.capabilities.map((capability) => (
                        <span key={capability}>{capability}</span>
                      ))}
                    </div>
                  )}
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
    </section>
  );
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
    capabilities: Array.isArray(baseModel.capabilities)
      ? baseModel.capabilities
      : Array.isArray(providerModel.capabilities)
        ? providerModel.capabilities
        : [],
  };
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
