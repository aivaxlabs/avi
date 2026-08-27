// Mermaid 11 renders diagram labels inside <foreignObject> HTML nodes even when
// flowchart.htmlLabels is false, and DOMPurify strips foreignObject content, leaving
// nodes without text. Rewrite each labeled foreignObject into plain SVG <text> so
// labels survive sanitization. Remove this transform once Mermaid restores native
// SVG text labels.
export function mermaidSvgWithTextLabels(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;
  for (const foreign of [...doc.querySelectorAll('foreignObject')]) {
    const lines = [...foreign.querySelectorAll('p')]
      .map((line) => line.textContent.trim())
      .filter(Boolean);
    const fallback = foreign.textContent.trim();
    const labelLines = lines.length > 0 ? lines : fallback ? [fallback] : [];
    const width = Number(foreign.getAttribute('width')) || 0;
    const height = Number(foreign.getAttribute('height')) || 0;
    const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('x', String(width / 2));
    text.setAttribute('y', String(height / 2));
    labelLines.forEach((line, index) => {
      const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.setAttribute('x', String(width / 2));
      if (index === 0 && labelLines.length > 1) tspan.setAttribute('dy', `${-(labelLines.length - 1) * 0.6}em`);
      if (index > 0) tspan.setAttribute('dy', '1.2em');
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    foreign.replaceWith(text);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
