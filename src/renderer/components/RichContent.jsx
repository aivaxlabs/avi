import {
  CircleCheck,
  CircleX,
  Copy,
  FileText,
  Info,
  TriangleAlert,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-diff';
import { useEffect, useId, useMemo, useState } from 'react';

import { mermaidSvgWithTextLabels } from '../lib/mermaid-svg';

const chartValueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const CALLOUT_ICONS = Object.freeze({
  danger: CircleX,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
});

export function RichContent({ part, onOpenFileReference, onFileReferenceContextMenu, children }) {
  if (part.type === 'chart') return <RichChart chart={part} />;
  if (part.type === 'copy') return <CopyablePanel label={part.label} value={part.value} />;
  if (part.type === 'callout') {
    return <DirectiveHeader className={`callout-heading callout-${part.kind}`} kind={part.kind} title={part.title}>{children}</DirectiveHeader>;
  }
  if (part.type === 'finding') {
    return <DirectiveHeader className={`finding-heading finding-${part.level.toLowerCase()}`} label={part.level} title={part.title}>{children}</DirectiveHeader>;
  }
  if (part.type === 'diff') return <DiffPanel diff={part} />;
  if (part.type === 'mermaid' || part.type === 'latex') {
    return <AsyncVisualization part={part} />;
  }
  return (
    <FileMention
      mention={part}
      onOpen={onOpenFileReference}
      onContextMenu={onFileReferenceContextMenu}
    >
      {children}
    </FileMention>
  );
}

export function CopyablePanel({ label, value, children, className = '' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(value ?? '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <section className={`copyable-panel ${className}`.trim()} aria-label={label}>
      <header className="copyable-panel-header">
        <span>{label}</span>
        <button type="button" onClick={handleCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
          <Copy size={13} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </header>
      {children ?? <pre className="copyable-panel-text">{value}</pre>}
    </section>
  );
}

function DirectiveHeader({ children, className, kind, label, title }) {
  const Icon = kind ? CALLOUT_ICONS[kind] : null;
  return (
    <h3 className={`directive-heading ${className}`} data-directive-label={label}>
      {Icon && <Icon size={17} aria-hidden="true" />}
      <span>{children || title}</span>
    </h3>
  );
}

function DiffPanel({ diff }) {
  const highlighted = useMemo(
    () => Prism.highlight(diff.value, Prism.languages.diff, 'diff'),
    [diff.value],
  );
  return (
    <CopyablePanel className="avi-diff" label={diff.title} value={diff.value}>
      <pre className="avi-diff-code language-diff">
        <code className="language-diff" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </CopyablePanel>
  );
}

function AsyncVisualization({ part }) {
  const id = useId().replaceAll(':', '');
  const [state, setState] = useState({ html: '', imageSrc: '', error: '' });
  useEffect(() => {
    let active = true;
    setState({ html: '', imageSrc: '', error: '' });
    void (async () => {
      try {
        let html = '';
        if (part.type === 'mermaid') {
          const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
            import('mermaid'),
            import('dompurify'),
          ]);
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'dark',
            flowchart: { htmlLabels: false },
          });
          const rendered = (await mermaid.render(`avi-mermaid-${id}`, part.source)).svg;
          const sanitized = DOMPurify.sanitize(mermaidSvgWithTextLabels(rendered), {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['foreignObject', 'script'],
            FORBID_ATTR: ['href', 'xlink:href'],
          });
          const imageSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
          if (active) setState({ html: '', imageSrc, error: '' });
          return;
        } else {
          const [{ default: katex }] = await Promise.all([
            import('katex'),
            import('katex/dist/katex.min.css'),
          ]);
          html = katex.renderToString(part.source, {
            displayMode: part.displayMode,
            output: 'htmlAndMathml',
            strict: 'warn',
            throwOnError: true,
            trust: false,
          });
        }
        if (active) setState({ html, imageSrc: '', error: '' });
      } catch (error) {
        if (active) setState({ html: '', imageSrc: '', error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [id, part.displayMode, part.source, part.type]);

  const label = part.type === 'mermaid' ? 'Mermaid diagram' : 'LaTeX equation';
  if (state.error) {
    return (
      <section className={`async-visualization ${part.type}-visualization has-error`} aria-label={label}>
        <strong>{`${label} could not be rendered`}</strong>
        <pre>{part.source}</pre>
      </section>
    );
  }
  if (state.imageSrc) {
    return <img className="async-visualization mermaid-visualization" src={state.imageSrc} alt={label} />;
  }
  if (!state.html) {
    return <div className={`async-visualization ${part.type}-visualization is-loading`} aria-label={`Rendering ${label}`} />;
  }
  return (
    <div
      className="async-visualization latex-visualization"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: state.html }}
    />
  );
}

function FileMention({ mention, onOpen, onContextMenu, children }) {
  const reference = {
    path: mention.path,
    lineFrom: mention.lineFrom,
    lineTo: mention.lineTo,
  };
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[mention.language];
    return grammar ? Prism.highlight(mention.value, grammar, mention.language) : '';
  }, [mention.language, mention.value]);
  const fileName = mention.path.split('/').filter(Boolean).at(-1) ?? mention.path;
  const lineLabel = mention.lineFrom === null
    ? ''
    : mention.lineFrom === mention.lineTo
      ? `, line ${mention.lineFrom}`
      : `, lines ${mention.lineFrom}-${mention.lineTo}`;
  const label = `${fileName}${lineLabel}`;

  return (
    <CopyablePanel label={label} value={mention.value} className="file-mention">
      <button
        type="button"
        className="file-mention-target"
        disabled={!onOpen}
        title={`Open ${mention.path}`}
        onClick={() => onOpen?.(reference)}
        onContextMenu={(event) => onContextMenu?.(event, reference)}
      >
        <FileText size={14} aria-hidden="true" />
        <span>{mention.path}</span>
      </button>
      {children ? (
        <div className="file-mention-content">{children}</div>
      ) : (
        <pre className={`file-mention-code language-${mention.language}`}>
          {highlighted ? (
            <code
              className={`language-${mention.language}`}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <code className={`language-${mention.language}`}>{mention.value}</code>
          )}
        </pre>
      )}
    </CopyablePanel>
  );
}

function RichChart({ chart }) {
  const max = Math.max(...chart.data.map((item) => item.value), 1);
  const total = chart.data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className={`rich-chart rich-chart-${chart.chartType}`} aria-label={chart.title}>
      <figcaption>{chart.title}</figcaption>
      {chart.chartType === 'bar' && <ChartBars data={chart.data} max={max} />}
      {chart.chartType === 'progress' && <ChartBars data={chart.data} progress />}
      {chart.chartType === 'line' && <LineChart data={chart.data} max={max} />}
      {chart.chartType === 'pie' && <PieChart data={chart.data} total={total} />}
    </figure>
  );
}

function ChartBars({ data, max, progress = false }) {
  return (
    <div className="rich-chart-bars">
      {data.map((item) => {
        const denominator = progress ? item.max : max;
        const percentage = (item.value / denominator) * 100;
        return (
          <div className="rich-chart-bar-row" key={item.label}>
            <span>{item.label}</span>
            <div
              role={progress ? 'progressbar' : undefined}
              aria-label={progress ? item.label : undefined}
              aria-valuemin={progress ? 0 : undefined}
              aria-valuemax={progress ? item.max : undefined}
              aria-valuenow={progress ? item.value : undefined}
            >
              <i style={{ width: `${percentage}%` }} />
            </div>
            <strong>{progress ? `${formatChartValue(item.value)} / ${formatChartValue(item.max)}` : formatChartValue(item.value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ data, max }) {
  const width = 640;
  const height = 220;
  const inset = 24;
  const points = data.map((item, index) => ({
    ...item,
    x: data.length === 1 ? width / 2 : inset + (index / (data.length - 1)) * (width - inset * 2),
    y: height - inset - (item.value / max) * (height - inset * 2),
  }));
  return (
    <div className="rich-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart plot">
        <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} />
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
        {points.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="5">
            <title>{`${point.label}: ${formatChartValue(point.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="rich-line-labels">
        {data.map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
    </div>
  );
}

function PieChart({ data, total }) {
  let offset = 0;
  const gradient = total > 0
    ? data.map((item, index) => {
      const start = offset;
      offset += (item.value / total) * 100;
      return `var(--chart-${index % 8}) ${start}% ${offset}%`;
    }).join(', ')
    : 'var(--background-4) 0 100%';
  return (
    <div className="rich-pie-layout">
      <div className="rich-pie" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label="Pie chart plot" />
      <ul>
        {data.map((item) => (
          <li key={item.label}>
            <i />
            <span>{item.label}</span>
            <strong>{formatChartValue(item.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatChartValue(value) {
  return chartValueFormatter.format(value);
}
