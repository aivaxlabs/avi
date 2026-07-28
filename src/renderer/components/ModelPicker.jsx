import {
  AudioLines,
  Brain,
  Image,
  Search,
  Server,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { classNames } from '../lib/format.js';

export function ModelPicker({
  models,
  favorites,
  currentModel,
  onClose,
  onChoose,
  onToggleFavorite,
}) {
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedModelId, setSelectedModelId] = useState(currentModel);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const groupedModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const groups = new Map();

    for (const model of models) {
      if (favoritesOnly && !favorites.includes(model.id)) continue;
      if (
        normalized
        && !`${model.name} ${model.modelId} ${model.providerName}`.toLowerCase().includes(normalized)
      ) {
        continue;
      }
      const group = groups.get(model.providerId) ?? {
        id: model.providerId,
        name: model.providerName,
        interface: model.interface,
        models: [],
      };
      group.models.push(model);
      groups.set(model.providerId, group);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        models: group.models.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [favorites, favoritesOnly, models, query]);

  const visibleModels = groupedModels.flatMap((group) => group.models);
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId)
    ?? visibleModels[0]
    ?? null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="model-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Choose model</h2>
            <p>Models configured locally for your providers.</p>
          </div>
          <button className="icon-button tiny" type="button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="model-picker-toolbar">
          <label className="model-filter-input">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter models..." />
          </label>
          <div className="model-provider-tabs">
            <button
              className={classNames(!favoritesOnly && 'active')}
              type="button"
              onClick={() => setFavoritesOnly(false)}
            >
              All
            </button>
            <button
              className={classNames(favoritesOnly && 'active')}
              type="button"
              onClick={() => setFavoritesOnly(true)}
            >
              Favorites
            </button>
          </div>
        </div>
        <div className="model-table-wrap">
          <div className="model-table">
            {groupedModels.map((group) => (
              <section key={group.id} className="model-provider-group">
                <h3>
                  <Server size={14} />
                  <span>{group.name}</span>
                  <small>{group.interface === 'responses' ? '/v1/responses' : '/v1/chat/completions'}</small>
                </h3>
                {group.models.map((model) => (
                  <article
                    key={model.id}
                    className={classNames('model-row', selectedModel?.id === model.id && 'active')}
                  >
                    <button
                      className="model-row-content"
                      type="button"
                      onClick={() => setSelectedModelId(model.id)}
                      onDoubleClick={() => {
                        onChoose(model.id);
                        onClose();
                      }}
                    >
                      <span className="model-row-name">
                        <strong>{model.name}</strong>
                        <small>{model.modelId}</small>
                      </span>
                      <span className="model-row-capabilities">
                        {model.capabilities.images && <Image size={14} aria-label="Image input" />}
                        {model.capabilities.audio && <AudioLines size={14} aria-label="Audio input" />}
                        {model.reasoning.length > 0 && <Brain size={14} aria-label="Reasoning" />}
                      </span>
                      <span>{formatTokens(model.context.input)} in</span>
                      <span>{formatTokens(model.context.output)} out</span>
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
                ))}
              </section>
            ))}
            {visibleModels.length === 0 && (
              <div className="empty-list">
                {models.length === 0
                  ? 'No models configured. Add one in Settings.'
                  : 'No models match this filter.'}
              </div>
            )}
          </div>
          {selectedModel && (
            <section className="selected-model-details">
              <div className="selected-model-heading">
                <span className="provider-fallback-icon"><Server size={22} /></span>
                <div>
                  <span>{selectedModel.providerName}</span>
                  <strong>{selectedModel.name}</strong>
                  <small>{selectedModel.modelId}</small>
                </div>
              </div>
              <div className="selected-model-body">
                <dl>
                  <div>
                    <dt>Interface</dt>
                    <dd>{selectedModel.interface === 'responses' ? '/v1/responses' : '/v1/chat/completions'}</dd>
                  </div>
                  <div><dt>Input context</dt><dd>{formatTokens(selectedModel.context.input)}</dd></div>
                  <div><dt>Output context</dt><dd>{formatTokens(selectedModel.context.output)}</dd></div>
                  <div>
                    <dt>Capabilities</dt>
                    <dd>
                      {[
                        selectedModel.capabilities.images && 'Images',
                        selectedModel.capabilities.audio && 'Audio',
                      ].filter(Boolean).join(', ') || 'Text'}
                    </dd>
                  </div>
                  <div>
                    <dt>Reasoning</dt>
                    <dd>{selectedModel.reasoning.join(', ') || 'Not configured'}</dd>
                  </div>
                </dl>
              </div>
            </section>
          )}
        </div>
        <footer className="dialog-footer model-dialog-footer">
          <span>{visibleModels.length} models</span>
          <div>
            <button
              type="button"
              className="primary-mini"
              disabled={!selectedModel}
              onClick={() => {
                onChoose(selectedModel.id);
                onClose();
              }}
            >
              Use model
            </button>
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function formatTokens(value) {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return value.toLocaleString();
}
