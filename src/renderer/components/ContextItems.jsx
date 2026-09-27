import { FileText, FolderCog, Workflow } from 'lucide-react';
import { useMemo } from 'react';

const tokenFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function ContextItems({ group, onOpen }) {
  const { roots, children } = useMemo(() => {
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
    return { roots, children };
  }, [group]);

  return (
    <div className="settings-context-item-list">
      {roots.map((item) => (
        <ContextItem key={item.path} item={item} groupId={group.id} childrenByPath={children} onOpen={onOpen} />
      ))}
      {!roots.length && <div className="settings-context-group-empty">No context items.</div>}
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
            <span>{item.activationMode === 'always-visible' ? 'Always visible' : 'On demand'}</span>
            {item.invocationMode && <span>{item.invocationMode === 'user-only' ? 'User only' : 'Assistant only'}</span>}
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
