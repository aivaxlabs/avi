import { RefreshCw, Search, Star, X } from 'lucide-react';
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

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return models
      .filter((model) => {
        if (tab === 'Favorites' && !favorites.includes(model.id)) return false;
        if (tab === 'Models' && !model.routed) return false;
        if (tab === 'AI Gateways' && model.routed) return false;
        if (!normalized) return true;
        return `${model.id} ${model.name} ${model.description}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [favorites, models, query, tab]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="model-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Choose model</h2>
            <p>Models and AI gateways available for this account.</p>
          </div>
          <div className="dialog-header-actions">
            <button className="icon-button" type="button" onClick={onRefresh}>
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" type="button" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        </div>
        <label className="dialog-search">
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
          {visibleModels.map((model) => (
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
                  <h3>{model.name || model.id}</h3>
                  <span>{model.id}</span>
                </div>
                {model.description && <p>{model.description}</p>}
                <div className="model-meta">
                  <span>In {formatPrice(model.pricing?.input)}</span>
                  <span>Out {formatPrice(model.pricing?.output)}</span>
                  <span>Cached {formatPrice(model.pricing?.cached)}</span>
                  <span>Speed {model.speed ?? '—'}</span>
                  <span>IQ {model.intelligence ?? '—'}</span>
                </div>
              </button>
              <button
                className={classNames('favorite-button', favorites.includes(model.id) && 'active')}
                type="button"
                onClick={() => onToggleFavorite(model.id)}
              >
                <Star size={16} />
              </button>
            </article>
          ))}
          {visibleModels.length === 0 && <div className="empty-list">No models here yet.</div>}
        </div>
      </section>
    </div>
  );
}
