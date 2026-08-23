import { Copy, FileText } from 'lucide-react';
import Prism from 'prismjs';
import { useMemo, useState } from 'react';

const chartValueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function RichContent({ part, onOpenFileReference, onFileReferenceContextMenu }) {
  if (part.type === 'chart') return <RichChart chart={part} />;
  if (part.type === 'copy') {
    return <CopyablePanel label={part.label} value={part.value} />;
  }
  return (
    <FileMention
      mention={part}
      onOpen={onOpenFileReference}
      onContextMenu={onFileReferenceContextMenu}
    />
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

function FileMention({ mention, onOpen, onContextMenu }) {
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
    </CopyablePanel>
  );
}

function RichChart({ chart }) {
  const max = Math.max(...chart.data.map((item) => item.value), 1);
  const total = chart.data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className={`rich-chart rich-chart-${chart.chartType}`} aria-label={chart.title}>
      <figcaption>{chart.title}</figcaption>
      {chart.chartType === 'bar' && (
        <div className="rich-chart-bars">
          {chart.data.map((item) => (
            <div className="rich-chart-bar-row" key={item.label}>
              <span>{item.label}</span>
              <div><i style={{ width: `${(item.value / max) * 100}%` }} /></div>
              <strong>{formatChartValue(item.value)}</strong>
            </div>
          ))}
        </div>
      )}
      {chart.chartType === 'line' && <LineChart data={chart.data} max={max} />}
      {chart.chartType === 'pie' && <PieChart data={chart.data} total={total} />}
    </figure>
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
