import { FileText, FolderCog, Workflow } from 'lucide-react';
import { useMemo } from 'react';

const tokenFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

const badges = {
  'always-visible': { label: 'Always visible', tone: 'success', title: 'Injected automatically into every ordinary chat.' },
  'on-demand': { label: 'On demand', tone: 'primary', title: 'Listed in the catalog; the agent reads it when relevant.' },
  'assistant-only': { label: 'Assistant only', tone: 'warn', title: 'Hidden from the composer picker; only the agent can use it.' },
  'user-only': { label: 'User only', tone: 'warn', title: 'Only available when selected by the user.' },
};

const createdTime = (item) => (item.createdAt ? Date.parse(item.createdAt) : 0);
const titleOrder = (left, right) => left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' });
const comparators = {
  default: (left, right) => (
    (left.relativePath ?? '').split('/').length - (right.relativePath ?? '').split('/').length
    || right.tokenCount - left.tokenCount
    || (left.relativePath ?? '').localeCompare(right.relativePath ?? '')
  ),
  tokens: (left, right) => right.tokenCount - left.tokenCount || titleOrder(left, right),
  'created-desc': (left, right) => createdTime(right) - createdTime(left) || titleOrder(left, right),
  'created-asc': (left, right) => createdTime(left) - createdTime(right) || titleOrder(left, right),
  'name-asc': titleOrder,
  'name-desc': (left, right) => titleOrder(right, left),
};

export function ContextItems({ group, query = '', sort = 'default', onOpen }) {
  const search = query.trim().toLowerCase();
  const { roots, children } = useMemo(() => {
    const compare = comparators[sort] ?? comparators.default;
    if (search) {
      return {
        roots: group.items
          .filter((item) => [item.title, item.description, item.relativePath]
            .some((value) => String(value ?? '').toLowerCase().includes(search)))
          .sort(compare),
        children: new Map(),
      };
    }

    const paths = new Set(group.items.map((item) => item.path));
    const children = new Map();
    const roots = [];
    for (const item of group.items) {
      if (group.id === 'skill' && item.parentSkillPath && paths.has(item.parentSkillPath)) {
        const siblings = children.get(item.parentSkillPath) ?? [];
        siblings.push(item);
        children.set(item.parentSkillPath, siblings);
      } else roots.push(item);
    }
    for (const siblings of children.values()) siblings.sort(compare);
    return { roots: roots.sort(compare), children };
  }, [group, search, sort]);

  return (
    <div className="settings-context-item-list">
      {roots.map((item) => (
        <ContextItem key={item.path} item={item} groupId={group.id} childrenByPath={children} onOpen={onOpen} />
      ))}
      {!roots.length && (
        <div className="settings-context-group-empty">
          {search ? `No items match "${query.trim()}".` : 'No context items.'}
        </div>
      )}
    </div>
  );
}

function ContextItem({ item, groupId, childrenByPath, onOpen }) {
  const children = childrenByPath.get(item.path) ?? [];
  const relativePath = (item.relativePath ?? '').replaceAll('\\', '/');
  const relativeDirectory = relativePath.slice(0, relativePath.lastIndexOf('/') + 1) || './';
  return (
    <div className="settings-context-entry">
      <button className="settings-context-item" type="button" title={item.path} onClick={() => onOpen(item.path)}>
        <span className="settings-entity-icon">
          {groupId === 'instruction' ? <FileText size={16} /> : groupId === 'skill' ? <FolderCog size={16} /> : <Workflow size={16} />}
        </span>
        <span className="settings-context-item-copy">
          <span className="settings-context-item-heading">
            <strong>{item.title}</strong>
            <span className="settings-context-relative-path" title={relativeDirectory}>{relativeDirectory}</span>
          </span>
          <small>{item.description}</small>
          <span className="settings-context-badges">
            {[item.activationMode === 'always-visible' ? 'always-visible' : 'on-demand', item.invocationMode]
              .filter(Boolean)
              .map((mode) => (
                <span key={mode} className="settings-context-badge" data-tone={badges[mode].tone} title={badges[mode].title}>
                  {badges[mode].label}
                </span>
              ))}
          </span>
        </span>
        <span className="settings-context-token-count">~{tokenFormatter.format(item.tokenCount)} tokens</span>
      </button>
      {children.length > 0 && (
        <details className="settings-context-subskills" open>
          <summary>Sub-skills <span>{children.length}</span></summary>
          <div>
            {children.map((child) => (
              <ContextItem key={child.path} item={child} groupId={groupId} childrenByPath={childrenByPath} onOpen={onOpen} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
