# Notes RPC

Notes methods run on the authenticated **global** `/rpc` socket. Use discovery to gate optional actions; these are additive RPC v1 methods, announced with the `notes` capability. Wire method tokens replace `:` with `.` as described in the [overview](overview.md).

The [Notes contract table](../../Notes.md#public-ipc--rpc-contract) documents list CRUD, note creation/editing/search, ordering, auxiliary generation, and attachment reads. `notes:get` accepts `{id}` and returns the full note snapshot, including ordered subtasks and attachment metadata. It rejects unknown IDs.

## Browser attachment upload

Use `notes:upload-attachment`, never a browser file path. The Desktop host cannot resolve a file path from the browser machine.

First chunk:

```json
{"id":"note-id","name":"report.pdf","size":400000,"offset":0,"data":"<base64 of first chunk>"}
```

Incomplete response:

```json
{"uploadId":"opaque-upload-id","offset":262144,"complete":false}
```

Continue with `{id, uploadId, offset, data}` using exactly the returned offset. Each request carries **at most 262,144 decoded bytes** as canonical base64 (at most 349,528 characters), staying below the 1 MiB RPC frame bound. The first request must contain data for non-empty files. Empty files use `size:0`, `offset:0`, `data:""` and complete immediately. The final chunk returns `{uploadId, offset, complete:true, note}`; only then does the attachment appear in the note.

- Declared size: 0–50 MiB, never exceeded by accepted chunks.
- Filename: 1–255 characters, a plain filename without directories, controls, Windows reserved names, trailing dots/spaces, or `\\ / : * ? " < > |`.
- Maximum four active uploads per Avi process; maximum 50 saved attachments per note.
- Uploads are bound to their note ID, expire ten minutes after creation, and do not resume across an Avi restart.
- Chunks must be sequential. Unknown uploads, wrong note IDs, mismatched offsets, malformed base64, and excess bytes reject.
- Cancel an unfinished upload with `{id, uploadId, cancel:true}`. Staging files are removed on cancellation, expiry, or finalization; original browser files are untouched.

Every chunk is a separate ordinary RPC operation. Keep its `operationId` stable across transport-level retries. Do not resend a timed-out chunk with a new operation ID or assume that a finalization failed: recover through `notes:get` before starting another upload to avoid duplicate attachments. The Workspace reports unknown outcomes rather than silently retrying mutations.

## Attachment download

`notes:read-attachment` takes `{id, attachmentId, offset:0, length:262144}` and returns `{name,size,offset,bytesRead,data}`. Validate the response, advance by `bytesRead`, and repeat until the declared size is reached. Data is base64; keep decoded bytes in memory and revoke download Blob URLs after use. The API exposes no internal file path.

`notes:add-attachment` remains available to trusted host-aware callers with `{id,path}`. Native picker/export operations are IPC-only. Notes do not have global RPC push events; refresh after mutations and poll while a Notes view is mounted to observe edits from Desktop or agents.
