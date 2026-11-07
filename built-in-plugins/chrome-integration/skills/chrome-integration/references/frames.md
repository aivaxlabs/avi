# Frames

## Same-origin frames

The snapshot lists their elements indented under the `iframe` line, with refs and top-level coordinates. Use those refs directly: `browser.click("@31")`. Queries search them too.

## Cross-origin frames

Payment forms, captchas, video players and embeds from another origin have no DOM access from the top page. The snapshot lists them under `Cross-origin frames` with a `frame_id` such as `f2`, and `browser.frames()` lists every frame with `frame_id`, `parent_frame_id`, `url`, `cross_origin` and `rect`.

Script inside one by passing `frame_id` to `chrome_run_actions`:

```json
{ "tab_id": "...", "frame_id": "f2", "code": "await browser.fill('input[name=cardnumber]', '4242 4242 4242 4242'); return browser.snapshot();" }
```

Inside a frame, every helper works on that frame's document, refs belong to that frame, and coordinates stay top-level viewport pixels. The post-action snapshot shows the frame. Use `frame_id: "main"` or omit it to return to the top document.

Frame IDs remain stable while the frame exists. If a frame reloads or is replaced and the ID no longer resolves, take a new top-level snapshot.
