import { ChevronDown, ChevronUp, MessageSquarePlus, MessagesSquare, PencilLine } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-yaml';
import { buildGitDiff, expandGitDiff } from '../lib/git-review.js';

const languages = { js: 'javascript', mjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', cs: 'csharp', css: 'css', xcss: 'css', html: 'markup', xml: 'markup', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml' };
const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function gitReviewAttachment(repository, path, content, comment = '', range = '') {
  return {
    id: crypto.randomUUID(), kind: 'context_marker', markerType: comment ? 'git_annotation' : 'file_citation',
    name: `${path}${range ? `:${range}` : ''}${comment ? ' · annotation' : ''}`, size: 0,
    filepath: repository.path === '.' ? path : `${repository.path}/${path}`,
    text: `<git-review-citation repository="${escapeXml(repository.path)}" path="${escapeXml(path)}" range="${escapeXml(range)}">\n<diff>${escapeXml(content)}</diff>${comment ? `\n<comment>${escapeXml(comment)}</comment>` : ''}\n</git-review-citation>`,
  };
}

const DiffRows = memo(function DiffRows({ rows, language, onExpand, onSelection }) {
  return <div className="git-diff-lines" onMouseUp={onSelection} onKeyUp={onSelection}>
    {rows.map((row, index) => row.type === 'gap' ? <div className="git-diff-gap" key={row.key} data-row-index={index}>
      <button type="button" title="Show 20 lines below the preceding change" aria-label="Expand hidden lines from top" onClick={() => onExpand(row.key, 'top', 20)}><ChevronDown size={14} /></button>
      <button type="button" onClick={() => onExpand(row.key, 'top', row.count)}>{row.count} hidden lines</button>
      <button type="button" title="Show 20 lines above the following change" aria-label="Expand hidden lines from bottom" onClick={() => onExpand(row.key, 'bottom', 20)}><ChevronUp size={14} /></button>
    </div> : <div className={`git-diff-line ${row.type}`} key={row.key} data-row-index={index}>
      <span className="git-diff-number" aria-hidden="true">{row.oldLine}</span>
      <span className="git-diff-number" aria-hidden="true">{row.newLine}</span>
      <span className="git-diff-sign" aria-hidden="true">{row.type === 'added' ? '+' : row.type === 'deleted' ? '−' : ' '}</span>
      {language && row.text.length < 2000 ? <code data-old-line={row.oldLine} data-new-line={row.newLine} dangerouslySetInnerHTML={{ __html: Prism.highlight(row.text || ' ', Prism.languages[language], language) }} />
        : <code data-old-line={row.oldLine} data-new-line={row.newLine}>{row.text || ' '}</code>}
    </div>)}
  </div>;
});

export const GitReviewDiff = memo(function GitReviewDiff({ repository, file, onAddToChat, onAskInSideChat }) {
  const model = useMemo(() => buildGitDiff(file), [file]);
  const [expanded, setExpanded] = useState({});
  const [selection, setSelection] = useState(null);
  const [annotation, setAnnotation] = useState('');
  const scroller = useRef(null);
  const thumb = useRef(null);
  const selectionRange = useRef(null);
  const rows = useMemo(() => expandGitDiff(model, expanded), [model, expanded]);
  const language = file.diff.length < 200_000 ? languages[file.path.split('.').at(-1).toLowerCase()] : null;
  const markers = useMemo(() => {
    const result = [];
    rows.forEach((row, index) => {
      if (row.type !== 'added' && row.type !== 'deleted') return;
      const previous = result.at(-1);
      if (previous?.type === row.type && previous.end === index) previous.end += 1;
      else result.push({ type: row.type, start: index, end: index + 1 });
    });
    return result;
  }, [rows]);
  const onExpand = useCallback((key, side, count) => setExpanded((current) => ({
    ...current, [key]: { top: current[key]?.top ?? 0, bottom: current[key]?.bottom ?? 0, [side]: (current[key]?.[side] ?? 0) + count },
  })), []);
  const onSelection = useCallback(() => {
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    if (!scroller.current?.contains(range.commonAncestorContainer)) return;
    const selectedCodes = [...scroller.current.querySelectorAll('.git-diff-line code')].filter((code) => range.intersectsNode(code));
    if (!selectedCodes.length) return;
    const content = selectedCodes.map((code) => {
      const part = range.cloneRange();
      if (!code.contains(part.startContainer)) part.setStart(code, 0);
      if (!code.contains(part.endContainer)) part.setEnd(code, code.childNodes.length);
      return part.toString();
    }).join('\n');
    if (!content.trim()) return;
    const first = selectedCodes[0];
    const last = selectedCodes.at(-1);
    const label = (code) => code.dataset.newLine ? `L${code.dataset.newLine}` : `old:L${code.dataset.oldLine}`;
    const rect = range.getBoundingClientRect();
    selectionRange.current = range.cloneRange();
    setSelection({ content, range: `${label(first)}-${label(last)}`, left: Math.max(8, Math.min(window.innerWidth - 325, rect.left)), top: Math.max(8, Math.min(window.innerHeight - 170, rect.bottom + 7)), annotating: false });
  }, []);

  useEffect(() => {
    const element = scroller.current;
    const update = () => {
      if (!thumb.current) return;
      thumb.current.style.height = `${Math.min(100, element.clientHeight / Math.max(1, element.scrollHeight) * 100)}%`;
      thumb.current.style.top = `${element.scrollTop / Math.max(1, element.scrollHeight) * 100}%`;
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [rows]);

  useEffect(() => {
    if (!selection) return undefined;
    if (globalThis.CSS?.highlights && globalThis.Highlight && selectionRange.current) CSS.highlights.set('git-review-selection', new Highlight(selectionRange.current));
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.target.closest?.('.selection-action-group, .git-review-annotation')) return;
      setSelection(null);
      setAnnotation('');
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    return () => {
      CSS.highlights?.delete('git-review-selection');
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
    };
  }, [selection]);

  return <div className="git-diff-viewer">
    <div className="git-diff-scroll" ref={scroller} tabIndex={0} role="region" aria-label={`Changes in ${file.path}`}>
      {file.binary || !file.diff ? <div className="git-review-empty">{file.message || (file.binary ? 'Binary file changed' : 'No textual changes in this view.')}</div>
        : <DiffRows rows={rows} language={Prism.languages[language] ? language : null} onExpand={onExpand} onSelection={onSelection} />}
    </div>
    <div className="git-diff-map" aria-label="Change map" onPointerDown={(event) => {
      if (event.target.closest('button')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      scroller.current.scrollTop = (event.clientY - rect.top) / rect.height * scroller.current.scrollHeight - scroller.current.clientHeight / 2;
    }} onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      scroller.current.scrollTop = (event.clientY - rect.top) / rect.height * scroller.current.scrollHeight - scroller.current.clientHeight / 2;
    }} onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}>
      {markers.map((marker) => <button key={marker.start} type="button" className={marker.type} aria-label={`Jump to ${marker.type} lines`} title={`Jump to ${marker.type} lines`}
        style={{ top: `${marker.start / rows.length * 100}%`, height: `${Math.max(.5, (marker.end - marker.start) / rows.length * 100)}%` }}
        onClick={() => scroller.current.querySelector(`[data-row-index="${marker.start}"]`)?.scrollIntoView({ block: 'center' })} />)}
      <div className="git-diff-map-thumb" ref={thumb} />
    </div>
    {selection && createPortal(selection.annotating ? <form className="git-review-annotation" style={{ left: selection.left, top: selection.top }} onSubmit={(event) => {
      event.preventDefault();
      if (!annotation.trim()) return;
      onAddToChat?.(gitReviewAttachment(repository, file.path, selection.content, annotation.trim(), selection.range));
      setSelection(null); setAnnotation('');
    }}>
      <textarea autoFocus aria-label="Review comment" value={annotation} onChange={(event) => setAnnotation(event.target.value)} placeholder="Add a review comment..." rows={3} />
      <footer><button type="button" onClick={() => { setSelection(null); setAnnotation(''); }}>Cancel</button><button type="submit" disabled={!annotation.trim()}>Add to chat</button></footer>
    </form> : <div className="selection-action-group" role="toolbar" aria-label="Selected diff actions" style={{ left: selection.left, top: selection.top }} onPointerDown={(event) => event.preventDefault()}>
      <button type="button" disabled={!onAddToChat} onClick={() => setSelection((current) => ({ ...current, annotating: true }))}><PencilLine size={13} />Annotate</button>
      <button type="button" disabled={!onAddToChat} onClick={() => { onAddToChat(gitReviewAttachment(repository, file.path, selection.content, '', selection.range)); setSelection(null); }}><MessageSquarePlus size={13} />Add to chat</button>
      {onAskInSideChat && <button type="button" onClick={() => { onAskInSideChat(gitReviewAttachment(repository, file.path, selection.content, '', selection.range)); setSelection(null); }}><MessagesSquare size={13} />Side chat</button>}
    </div>, document.body)}
  </div>;
});
