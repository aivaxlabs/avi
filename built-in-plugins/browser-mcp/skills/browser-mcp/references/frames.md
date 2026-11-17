# Frames and shadow DOM

Selectors and refs reach iframes, including iframes from another origin, and open shadow DOM without any extra step. The snapshot lists their elements with refs like the rest of the page.

## Iframes

`browser.frame(target)` scopes selectors and snapshots to one iframe. The target must be the `iframe` element. The scope lasts until `browser.frame("main")` or until the page navigates.

```javascript
await browser.frame("iframe#checkout");
await browser.fill("input[name=card]", "4111111111111111");
await browser.frame("main");
```

Use it when the same selector matches in several frames or when you want a snapshot of one frame only.

## Shadow DOM

A selector must match inside a single root: `"#host #inner"` does not cross a shadow boundary. Use `"#inner"` or a ref.

Closed shadow roots are reachable by ref only. `browser.shadowelements(target?)` lists the refs of the elements inside shadow roots, with the root mode (`open` or `closed`).
