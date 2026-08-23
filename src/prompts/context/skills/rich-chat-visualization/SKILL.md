---
name: rich-chat-visualization
description: Render charts, referenced file excerpts, and copyable text fields in Avi chat using the supported HTML-in-Markdown contract. Use when a response benefits from structured visual data, source excerpts, or text the user should copy.
user-invocable: false
---
# Rich Chat Visualization

Avi recognizes three restricted HTML-in-Markdown blocks in assistant messages. Use them only when the richer presentation improves comprehension or gives the user a useful copy target. Ordinary prose, tables, code fences, and `<fileref>` links remain preferable for simple responses.

Put every rich block on its own lines. Do not wrap it in a Markdown code fence. The renderer accepts only the exact `avi-*` elements below; arbitrary HTML is not rendered.

## Charts

Use `<avi-chart>` for bar, line, or pie charts. Its body must be a JSON array of objects with a non-empty string `label` and a finite, non-negative numeric `value`.

```html
<avi-chart type="bar" title="Requests by method">
[{"label":"GET","value":128},{"label":"POST","value":64},{"label":"DELETE","value":8}]
</avi-chart>
```

- `type` is required: `bar`, `line`, or `pie`.
- `title` is optional and defaults to `Chart`.
- Supply 1–24 items.
- Use `bar` to compare categories, `line` for an ordered sequence, and `pie` only for parts of a whole.
- Keep labels short and unique within the chart. Preserve the intended item order.
- Do not use colors, markup, expressions, `NaN`, `Infinity`, negative values, or nested datasets.

## File mentions

Use `<avi-file-mention>` to display a text or code excerpt that points to a real workspace-relative file. Avi renders the excerpt with Prism syntax highlighting, a copy action, and the same open/context-menu behavior as a file reference.

```html
<avi-file-mention path="./src/main/runtime.js" line-from="120" line-to="128" language="js">
const result = await runner.execute(request);
return result;
</avi-file-mention>
```

- `path` is required and must begin with `./` or `../`.
- `line-from` is optional and must be a positive integer.
- `line-to` is optional, requires `line-from`, and must be greater than or equal to it.
- `language` is optional. If omitted, Avi derives it from the file extension.
- The body is the exact excerpt to display and copy. Include only content actually read from that file and keep line attributes aligned with it.
- Escape text that would be interpreted as HTML: `&` as `&amp;`, `<` as `&lt;`, and `>` as `&gt;`.
- Use a normal `<fileref path="./file.js" line-from="12" line-to="18" />` when the excerpt itself does not need to be visible.

## Copyable text

Use `<avi-copy>` for commands, prompts, configuration fragments, identifiers, or other plain text the user is likely to copy as a unit.

```html
<avi-copy label="Command">
bun run renderer:build
</avi-copy>
```

- `label` is optional and defaults to `Copyable text`.
- The body must not be empty.
- The body is displayed as plain preformatted text, not Markdown or executable HTML.
- Escape `&`, `<`, and `>` as XML entities when they are literal content.
- Do not use this block for secrets, credentials, hidden reasoning, or sensitive data.

## Composition and fallbacks

Rich blocks can appear between normal Markdown paragraphs. Keep a blank line before and after each block. Multiple blocks are allowed.

If a block is malformed, unsupported, incomplete while streaming, or placed inside a code fence, Avi leaves it as ordinary Markdown/text instead of executing HTML. Never rely on arbitrary HTML, scripts, event handlers, inline styles, external assets, or embedded URLs.
