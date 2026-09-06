# ORPC/1 — Ordered Remote Procedure Call

**Status:** Draft 1 — experimental

**Encoding:** ASCII framing and headers; opaque binary content

**State model:** Stateless between calls

[Project overview](README.md) · [Repository](https://github.com/aivaxlabs/orpc) · [MIT License](LICENSE)

## Contents

1. [Purpose](#1-purpose)
2. [Stateless model](#2-stateless-model)
3. [Required transport contract](#3-required-transport-contract)
4. [Encoding and content](#4-encoding-and-content)
5. [Terminology](#5-terminology)
6. [Frame format](#6-frame-format)
7. [Correlation and multiplexing](#7-correlation-and-multiplexing)
   - [Acknowledged notifications](#71-acknowledged-notifications)
8. [Response production](#8-response-production)
9. [Ordered reconstruction](#9-ordered-reconstruction)
10. [Reliability and re-requesting](#10-reliability-and-re-requesting)
11. [Opaque results and failures](#11-opaque-results-and-failures)
12. [Limits and backpressure](#12-limits-and-backpressure)
13. [Security considerations](#13-security-considerations)
14. [Examples](#14-examples)
15. [Conformance requirements](#15-conformance-requirements)
16. [Draft 1 boundaries](#16-draft-1-boundaries)
17. [Draft status](#17-draft-status)

## 1. Purpose

ORPC exchanges potentially large binary application payloads over reliable ordered byte streams or transports delivering complete frames with integrity. Multiple calls and segmented responses can share one logical channel, allowing other messages to make progress while a large response is transferred.

ORPC provides request correlation, segmentation of responses, ordered reconstruction, completion detection, and mandatory recovery by requesting the resource again when delivery is incomplete.

**Ordered means ordering the parts of one response, not ordering the execution or completion of different calls.** Sending `document.update` before `document.read` does not guarantee that the read observes the update. Applications MUST explicitly coordinate such dependencies.

ORPC is opaque to application content. It does not know whether content is text, JSON, a successful result, an application error, or an encoded file. It only carries opaque bytes.

ORPC is an independent protocol, not an extension of JSON-RPC.

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative requirements.

## 2. Stateless model

**ORPC is stateless between calls.** Each request MUST be self-contained and MUST NOT depend on an ORPC session, a previous request, a stored transfer cursor, or previously delivered parts.

ORPC defines no session establishment, persistent transfer record, server-side resume mechanism, or requirement to cache responses. A new request MAY be handled by another server instance without restoring ORPC protocol state.

The server MAY retain temporary working state while executing a request and emitting its response. The receiver MUST maintain temporary per-request reconstruction state to order parts and determine completion. This transient state is not a persistent session and MUST be released when the attempt completes, fails, or is cancelled.

A transport MAY be connection-oriented. A persistent WebSocket connection does not make ORPC sessionful. Transport authentication and routing MAY have their own state, outside ORPC.

Application data may be stateful. ORPC's statelessness does not prohibit databases, authorization, application-level idempotency records, or other application state.

Recovery always starts a new, self-contained request. ORPC does not resume a previous transfer or request individual missing parts.

## 3. Required transport contract

**ORPC defines its own length-prefixed framing. It MUST use either a reliable, ordered byte stream or a transport that delivers complete frames with integrity.**

TCP, STDIO pipes, and stream-oriented Unix sockets can carry ORPC directly. Reads may contain a partial frame or several frames; the ORPC parser reconstructs boundaries using the byte-length prefix defined in Section 6. Stream transports MUST preserve byte order without gaps while usable. EOF or failure in a partial frame is a delivery failure, not a complete frame.

On message-oriented bindings such as WebSocket or queues, each transport message MUST contain exactly one complete length-prefixed ORPC frame. The declared size MUST match the actual payload size. A direct WebSocket binding MUST use binary messages, even when the body happens to be text. A binding may fragment internally only if it restores the complete frame before ORPC delivery. An HTTP binding MUST define stream or complete-frame delivery and reply routing explicitly.

Complete-frame bindings MAY reorder, duplicate, or lose frames. ORPC orders complete response parts; it does not reorder bytes or fragments inside a frame and does not repair corrupted bytes.

UDP is not automatically supported. A UDP binding MUST deliver one complete frame per datagram within its supported size and integrity constraints, or provide external fragmentation/reassembly and integrity handling before ORPC delivery. IP alone supplies neither reliable delivery nor the byte-stream guarantees required here.

Each binding MUST document:

- Its stream or complete-frame delivery mode and maximum accepted frame size in bytes.
- How stream ordering or complete-frame integrity is provided.
- How requests reach servers and responses return to their originating clients.
- How unavailable channels, closure, and send failures are reported.
- Its backpressure and queue-management mechanisms.
- Its delivery, duplication, and integrity guarantees.
- Its authentication and peer-isolation requirements.

Lower-layer fragmentation is invisible to ORPC. It does not replace ORPC segmentation or remove a transport's complete-message size limit.

A text-only transport requires an explicitly agreed adapter that losslessly encodes the complete binary frame, for example with Base64, and decodes it before ORPC parsing. The ORPC length counts original payload bytes, not adapter characters or Base64 bytes. Transport limits apply to the encoded envelope as well. Such adaptation MUST NOT be inferred from content and is not part of the core wire format.

ORPC does not negotiate these binding properties in Draft 1. Both peers MUST use a compatible binding configuration.

### 3.1 STDIO binding requirements

STDIO deployments MUST reserve stdout exclusively for ORPC frames and send logs and diagnostics to stderr. They MUST exchange bytes without newline translation or implicit text normalization. Each direction MUST serialize writes by complete frame: partial OS writes may be continued, but bytes of another frame MUST NOT be interleaved. Writers MUST respect backpressure and handle short writes and broken pipes.

Readers MUST support arbitrary read boundaries, including a prefix, header, or binary body split across reads. EOF after complete frames is a channel closure; EOF in a prefix or before all declared payload bytes arrive is an incomplete-frame failure. Pending calls still follow the recovery rules in Section 10.

## 4. Encoding and content

The decimal length prefix, SP delimiter, and internal header MUST be ASCII and conform to the grammar in Section 6. The header terminator is the LF byte `0x0A`. Non-ASCII header bytes MUST be rejected.

Content is an arbitrary byte sequence, possibly empty. Every byte value, including NUL, LF, and bytes invalid in UTF-8, is permitted in the body. Receivers MUST preserve content byte-for-byte and MUST NOT decode, normalize, escape, or reject it based on a text encoding. ORPC does not automatically encode or decode Base64.

Senders MAY split response content at any byte boundary, including within a UTF-8 code point or an application record. Receivers concatenate body bytes in part order. Applications using text SHOULD encode it explicitly, for example as UTF-8, and decode after full reconstruction. Incremental consumers MUST maintain decoder state across parts rather than decoding each part independently; decoder and provisional-result state MUST be reset when an attempt is abandoned.

Application methods define their content contracts outside ORPC. The protocol includes no content type, application status, JSON schema, encoding field, or binary flag. Raw files can be transmitted without Base64 on byte-preserving bindings.

## 5. Terminology

- **Client:** the endpoint initiating a particular call.
- **Server:** the endpoint responding to that call. Either peer MAY initiate other calls.
- **Channel:** the logical message exchange provided by a binding; not an ORPC session.
- **Attempt:** one request and its corresponding response, identified by a fresh request identifier.
- **Execution identifier:** a server-generated identifier distinguishing one response-producing execution from other executions of the same request.
- **Part:** a numbered segment of response content within one execution.
- **Logical operation:** one application resource request, potentially spanning several attempts during recovery.

## 6. Frame format

A frame consists of a decimal byte length, one ASCII space, and a payload:

```text
<length> SP <payload>
<payload> = <header> LF <content>
```

`length` counts ALL bytes of the payload: the internal header, its LF separator, and the complete body. It EXCLUDES the prefix digits and the first separating space. It is not a character count or a body-only count.

The length MUST be a positive decimal integer without signs or leading zeros, at most 16 digits, and no greater than 9,007,199,254,740,991. Implementations MUST apply a smaller configured payload-size limit appropriate to their resources before allocating payload storage. A syntactically permitted length is not a requirement to accept or allocate it.

The internal separator is exactly byte `0x0A`. Senders MUST NOT use CRLF for it. Only the first LF within the bounded payload separates header from content. Later newlines, spaces, digits, and apparent headers belong to the body. No escaping is required.

The internal LF is REQUIRED even for empty content. No separator is required or permitted as framing padding after the body: the next frame's prefix can begin immediately after the final payload byte. A trailing newline intended as content MUST be included in the declared length.

Textual frame examples in this document use ASCII headers and UTF-8 bodies for display only. They omit a trailing body LF unless explicitly stated; the newline used to lay out a Markdown closing fence is not a transmitted byte. Binary examples explicitly identify their byte notation, which is not a wire escape syntax.

### 6.0 Incremental parsing

A receiver MUST bound and validate prefix digits as they arrive, rejecting malformed, overflowing, overlong, zero, or locally oversized lengths before payload-sized allocation. It then consumes exactly N payload bytes, validates the ASCII internal header, and repeats for remaining bytes. It MUST support partial prefixes, partial payloads, and multiple frames in one read. It MUST NOT decode the payload as text or treat read boundaries as frame boundaries. The first LF within the bounded payload terminates the header; every subsequent byte is opaque body content. Missing LF or a header exceeding its limit is invalid, regardless of body bytes.

In complete-frame mode, the prefix and payload MUST occupy exactly one delivered message, without missing or extra bytes. In stream mode, bytes beyond N begin the next frame. Invalid framing MUST fail the affected message or stream; implementations MUST NOT scan opaque content for `ORPC/1` to guess resynchronization. A damaged stream MUST be closed rather than continue at an untrusted boundary.

EOF during a prefix or payload is incomplete delivery. Any affected pending operation MUST follow bounded recovery, not complete with the available prefix of its content.

### 6.1 Request

```text
<length> ORPC/1 REQ<id> <method>
<content>
```

Example:

```text
33 ORPC/1 REQ125 archive.read
foobar
```

`REQ` and the identifier form one token, without an intervening space. The header has exactly three tokens separated by one ASCII space.

The method is an application-defined routing name. All application inputs needed to execute the request MUST be contained in the request or supplied by the transport's independently defined authentication context. ORPC MUST NOT require a prior protocol request to interpret it.

**Draft 1 requests are single-frame.** The complete request frame, including length-prefix and header overhead, MUST fit the configured frame-size limit and any transport message-size limit. Large request uploads require bounded application operations or a later segmented-request specification. This draft does not define request-part fields.

### 6.2 Response

```text
<length> ORPC/1 RES<id> <execution> <part> <final>
<content>
```

Example:

```text
42 ORPC/1 RES125 exec-A 1 0
conteúdo parcial
```

```text
31 ORPC/1 RES125 exec-A 2 1
 final
```

The reconstructed result is exactly `conteúdo parcial final`.

The header has exactly five tokens separated by one ASCII space:

- `RES<id>` correlates the frame with its request attempt.
- `execution` identifies one server execution producing that response.
- `part` is a one-based positive decimal integer.
- `final` is exactly `0` or `1`.
- `final = 1` declares that this part number is the total part count.

A single-part response uses `1 1`. An empty response is one final frame with an empty body.

### 6.3 Lexical rules

| Field | Representation |
| --- | --- |
| Version | Exactly `ORPC/1` |
| Request identifier | 1–64 ASCII characters from `A–Z`, `a–z`, `0–9`, `_`, `-` |
| Execution identifier | 1–64 ASCII characters from `A–Z`, `a–z`, `0–9`, `_`, `-` |
| Method | 1–128 ASCII characters from `A–Z`, `a–z`, `0–9`, `_`, `-`, `.` |
| Part | Integer 1 through 9,007,199,254,740,991, written in decimal without leading zeros |
| Final | Exactly `0` or `1` |

All tokens are case-sensitive. Identifiers are opaque strings; numeric examples do not require integer interpretation. The header, excluding LF, MUST NOT exceed 256 bytes.

Unsupported versions, missing separators, invalid fields, additional header tokens, and non-ASCII header bytes are protocol violations. Non-UTF-8 body bytes are valid.

## 7. Correlation and multiplexing

A client MUST assign a fresh identifier to every attempt, including retries. An identifier MUST NOT collide with another attempt whose frames could still be delivered to that receiver, including attempts made before reconnection.

Collision-resistant random identifiers are RECOMMENDED. Short sequential identifiers are acceptable only when the binding and identifier lifecycle prevent collision with delayed frames.

The identifier belongs to the request, not to a session or resource. It MUST NOT serve as the application's persistent idempotency token.

Parts from different responses MAY be freely interleaved:

```text
43 ORPC/1 RES125 exec-A 1 0
first part for 125
```

```text
48 ORPC/1 RES126 exec-B 1 1
complete result for 126
```

```text
42 ORPC/1 RES125 exec-A 2 1
last part for 125
```

The receiver MUST reconstruct each pending request independently. A frame for one identifier MUST NOT change another request's state.

For bidirectional calls, `REQ` identifies a call initiated by the sending peer and `RES` identifies a response to a call initiated by the receiving peer. Identifiers are correlated within those directional roles and the authenticated routing context.

Senders SHOULD schedule parts fairly. One large response SHOULD NOT monopolize a channel while other responses are ready.

If a channel also carries non-ORPC traffic, its binding MUST provide an unambiguous outer discriminator before ORPC parsing. Raw logs or unrelated bytes MUST NOT be injected into an ORPC stream. Concurrent ORPC calls already share the channel through request identifiers; their frames need no additional discriminator.

### 7.1 Acknowledged notifications

ORPC notifications MUST use ordinary bidirectional calls, not fire-and-forget frames. A peer delivering an event sends a `REQ` naming the application's event-handling method. The receiving peer MUST return a `RES`, even when the handler has no substantive result. For that call, the event emitter acts as the ORPC client and the event receiver acts as the ORPC server, regardless of their usual deployment roles.

Example: a server delivers an event to a client:

```text
93 ORPC/1 REQevt-123 conversation.changed
{"eventId":"change-456","conversationId":"thread-789"}
```

The client acknowledges it:

```text
31 ORPC/1 RESevt-123 exec-C 1 1
OK
```

The response MUST follow the normal response rules, including an execution identifier, part numbering, and a final marker. `OK` is an application convention, not an ORPC keyword or status. An empty final response is also valid if the application defines it as acknowledgment. The request body in this example is application-defined JSON; ORPC does not parse it.

The application MUST define what acknowledgment means. The RECOMMENDED meaning is **accepted by the receiving application**, not that every downstream effect has finished. The receiver MUST NOT acknowledge acceptance before it has actually occurred. Acceptance alone does not imply durable storage or survival of a process crash; applications needing durable delivery MUST define a durable acceptance boundary. Rejection MAY be represented by an application-defined response content, which ORPC treats as complete content rather than interpreting it as success or failure.

If the acknowledgment is incomplete or lost, the event emitter MUST follow the same bounded whole-request recovery policy as any other caller. It reissues the event method and identical content under a fresh request identifier. A lost acknowledgment does not prove the event was not accepted or processed.

Event handlers MUST therefore be safe to repeat. When duplicate effects must be prevented, the application MUST carry a stable event identifier in the opaque content and deduplicate at the receiver. That event identifier remains unchanged across attempts; it is distinct from both the ORPC request and execution identifiers. Deduplication and any required persistence belong to the application, not to an ORPC session.

A `RES` acknowledgment MUST NOT itself generate another acknowledgment. Only `REQ` initiates a call, so notification confirmation does not create an acknowledgment loop. Completion or cancellation releases the ordinary transient call state; ORPC requires no persistent notification record or replay service.

Notification payloads remain subject to Draft 1's single-frame request limit. This pattern does not add segmented requests or guarantee ordering between separate events; applications needing event sequence semantics MUST define them in their content.

## 8. Response production

A server produces one logical byte-sequence response per execution. It MAY divide that response into multiple parts without understanding its format.

Before emitting a response, the server MUST assign an execution identifier distinct from every other execution of that request whose frames could reach the client, including executions on other server instances. Independently generated collision-resistant random identifiers with at least 128 bits of randomness are RECOMMENDED; coordination or persistent execution history is not required. Short execution identifiers in examples are illustrative, not a recommended generation strategy.

Every part of that execution MUST carry the same execution identifier. A duplicate request that is executed again MUST receive a new execution identifier, even if its content is identical. Re-delivery of frames from the same execution MUST preserve the original identifier. A restarted or regenerated response MUST NOT reuse an earlier execution identifier.

Part numbers MUST form a contiguous sequence beginning at 1 and ending at the final part number within each execution. Exactly one part position MUST be final. Content and final status for a given request identifier/execution identifier/part tuple MUST remain immutable.

Servers SHOULD emit parts in increasing order, but clients MUST support reordered delivery.

Each complete frame MUST fit the configured frame-size limit and any binding message-size limit. Senders MUST measure actual bytes, including the length prefix, its SP, internal header, and LF overhead, rather than character count. The prefix value itself counts only the payload. ORPC recommends no universal frame size. Implementations SHOULD make the target size configurable and evaluate throughput together with the latency of small calls sharing a channel with large responses.

A producer MUST NOT mark a response final if it has emitted only a prefix of its intended content and then failed. The client will detect incomplete delivery and recover. An application MAY instead supply a complete application error response, provided it has not already emitted incompatible partial content for that attempt.

Transport retransmission of an identical frame does not create a new part. ORPC defines no selective retransmission service and does not require the server to store emitted frames.

## 9. Ordered reconstruction

The receiver temporarily tracks a selected execution identifier, received parts, the next expected part number, an optional final part number, duplicate-validation information, deadlines, and resource usage for each pending attempt.

The first valid response frame for a pending attempt selects its execution identifier, regardless of that frame's part number. Thereafter, the receiver MUST discard frames for other executions of that attempt before updating part, final-marker, or duplicate-validation state. Such discarded frames MUST NOT extend deadlines. They are not conflicting parts of the selected execution.

The receiver MUST NOT switch executions within an attempt, even if another execution appears complete or the selected execution stalls. If the selected response is incomplete, recovery abandons the entire attempt and uses a fresh request identifier. Execution selection requires only transient local state, not a session or a server-side transfer cache.

After applying the execution-selection rules, it MUST process valid frames from the selected execution as follows:

1. Discard responses for unknown, completed, or abandoned attempts. Such frames MUST NOT create a pending request or trigger a retry.
2. If a part was already received, ignore the duplicate only when its body and final flag are identical. A conflicting duplicate invalidates the attempt.
3. If `final = 1`, record its part number as the final number. A different final number invalidates the attempt.
4. Reject any part beyond a known final number. A final number below a previously received part also invalidates the attempt.
5. Buffer parts that arrive ahead of the next expected number. Consume bodies only in ascending contiguous order.
6. Complete only when every part from 1 through the declared final number has been received and validated.

Bodies are concatenated without any inserted bytes. A final frame arriving first does not complete the response. Receiving parts 1 and 3, where part 3 is final, leaves the response incomplete until part 2 arrives.

Identical-duplicate handling MUST apply even after a part's body has been consumed. Implementations retaining only fingerprints MUST use collision-resistant validation appropriate to their integrity requirements.

Receivers MAY expose ordered contiguous content before completion, but MUST identify it as provisional. On failure or retry, the consumer MUST be informed that the attempt was abandoned. Content from different attempts MUST NOT be combined.

Implementations MAY spool ordered content to a file or bounded sink. Statelessness does not eliminate temporary storage needed to reconstruct an active response.

## 10. Reliability and re-requesting

### 10.1 Detecting loss

Each attempt MUST have a finite absolute deadline. An inactivity timeout MAY additionally apply. Duplicate or unrelated frames MUST NOT indefinitely extend an attempt's lifetime.

Out-of-order arrival alone is not a failure. Missing parts MUST be allowed to arrive until the deadline unless the transport reports definitive failure.

An attempt is incomplete if its deadline expires or its channel definitively fails before reconstruction finishes. This includes no response, a missing intermediate part, a missing final marker, or a final marker received without all preceding parts.

### 10.2 Mandatory recovery

**If the client does not receive all response parts, it MUST request the resource again. Partial content MUST NOT be returned as a completed result.**

The client MUST:

1. Abandon the incomplete attempt and invalidate its provisional result.
2. Allocate a fresh request identifier.
3. Reissue the same method and application request content.
4. Reconstruct the new response independently, starting from part 1.
5. Discard late responses belonging to the old attempt.

No transfer state is recovered from the previous server. A different server MAY handle the new attempt.

Clients MUST support at least one automatic recovery attempt for incomplete delivery. Recovery MUST use bounded backoff, a finite retry budget, and a finite overall logical-operation deadline. Implementations MUST make these policies explicit and configurable.

If the channel is unavailable, recovery waits for a usable channel within the overall deadline. If recovery cannot complete within that deadline or retry budget, the client MUST report an explicit incomplete-delivery failure.

Explicit cancellation, authentication failure, unsupported protocol versions, conflicting frames, or local resource-limit violations MUST terminate the attempt rather than trigger an automatic retry loop. A cancelled operation MUST NOT be reissued. Recovery is not required after caller cancellation or after the overall recovery policy has been exhausted.

ORPC reliability means complete ordered reconstruction when recovery succeeds, or explicit failure when it cannot. It does not guarantee progress during permanent outages or unlimited message loss.

### 10.3 Safe repeated execution

Re-requesting a resource may execute the method more than once. **ORPC does not guarantee exactly-once execution.**

Every application method exposed under this automatic-recovery contract MUST be safe to repeat. It MUST be read-only, idempotent, or protected by application-level idempotency handling.

For non-idempotent operations, the application MUST supply a stable idempotency token in the opaque request content and enforce deduplication in its own domain. That token MUST remain unchanged across ORPC retries, while the ORPC identifier changes. Such records are application state, not an ORPC session or transfer cache.

A deployment requiring no server-side deduplication state at all MUST restrict exposed methods to operations naturally safe to repeat. Methods that cannot be made repeat-safe MUST NOT be exposed under Draft 1's automatic-recovery contract.

A duplicating transport can also duplicate complete requests before the client initiates recovery. The same application repeat-safety requirement applies. A binding SHOULD suppress duplicate request deliveries when feasible; ORPC itself does not require a persistent request-history table.

Duplicate request executions MUST have distinct execution identifiers. The receiver selects only one execution as specified in Section 9, so parts from duplicate executions cannot be mixed into a synthetic result. This prevents content mixing; it does not suppress duplicate application side effects or guarantee that the selected execution finishes. Application repeat-safety remains REQUIRED even for read operations whose returned bytes may change.

### 10.4 Changing resources

A new request may observe a newer version of a resource. ORPC does not promise identical content across attempts. It MUST NOT combine old and new response parts.

If a stable snapshot is required, the application MUST include and enforce a resource version or equivalent token in the self-contained request. ORPC does not interpret it.

## 11. Opaque results and failures

All application results use the same response framing. These bodies are equally opaque to ORPC:

```text
hello
```

```json
{"messages":[],"hasMore":false}
```

```json
{"error":"Resource not found"}
```

```text
SGVsbG8=
```

A complete response representing an application error is still complete delivery and MUST NOT trigger ORPC recovery merely because of its content.

Protocol and transport failures are reported through the implementation's local API or binding diagnostics. Draft 1 defines no `ERR` frame or application error schema. An application dispatcher MAY produce application-defined content for an unknown method; ORPC does not define that representation.

## 12. Limits and backpressure

ORPC imposes no fixed 1 MiB ceiling on reconstructed responses. It does not require unlimited buffering or storage.

Implementations MUST enforce documented limits for:

- Concurrent active requests and server executions.
- Complete transport-message size.
- Part count and out-of-order storage per request.
- Total accepted response size.
- Aggregate memory or spooled storage across requests.
- Attempt duration, retries, and overall operation duration.
- Outgoing queue size and transmission rate.

Implementations MUST avoid allocation proportional to an untrusted part number. Bounded mappings SHOULD be used for out-of-order parts rather than large indexed arrays.

Senders MUST respect transport backpressure and aggregate traffic budgets. Segmenting a response MUST NOT bypass rate limits or flood the outgoing queue. Implementations SHOULD retain per-call pending parts above the transport queue and interleave bounded byte budgets between ready calls, rather than enqueueing an entire large response ahead of all other calls. Round-robin scheduling with byte budgets is one possible implementation, not a required algorithm. Multiplexing permits interleaving but does not by itself guarantee low latency.

Limits SHOULD reject or fail the affected operation explicitly instead of silently terminating unrelated calls on the same channel.

A local resource-limit failure MUST NOT automatically re-request the same resource without a changed resource policy. Segmentation cannot make an unlimited response safe for a receiver with finite resources.

## 13. Security considerations

The binding and application MUST provide appropriate peer authentication, authorization, integrity, and confidentiality. Request identifiers do not authenticate senders.

Servers MUST authorize each request independently of ORPC history. Transport-level authentication MAY supply the caller identity, but a previous successful ORPC request MUST NOT be a prerequisite for authorizing the next one.

Applications MUST treat content as untrusted input. ORPC's opaque-content contract does not make decoded JSON, Base64, paths, or application commands safe.

Logs SHOULD record identifiers, part numbers, byte counts, timing, and failure reasons without recording sensitive payloads by default.

## 14. Examples

### 14.1 Single response

```text
33 ORPC/1 REQ125 archive.read
foobar
```

```text
41 ORPC/1 RES125 exec-A 1 1
complete content
```

### 14.2 Reordered delivery

Arrival order:

```text
26 ORPC/1 RES125 exec-A 3 1
C
```

```text
26 ORPC/1 RES125 exec-A 1 0
A
```

```text
26 ORPC/1 RES125 exec-A 2 0
B
```

The receiver returns exactly `ABC` after all three frames arrive. It does not return `CAB` or complete upon part 3 alone.

### 14.3 Missing part

Parts 1 and 3 arrive for request `125`; part 3 is final. Part 2 never arrives. The deadline expires, the client abandons `125`, and sends:

```text
33 ORPC/1 REQ126 archive.read
foobar
```

The server handles `126` as a new request, without needing any state from `125`. Delayed `RES125` frames are discarded.

### 14.4 Binary application data

An application supplies raw file bytes. ORPC segments them without Base64 and reconstructs the identical byte sequence. For example, a body containing four bytes `00 FF 0A 80` has a 29-byte payload with the following 25-byte header and LF:

```text
29 ORPC/1 RES125 exec-A 1 1
```

The complete frame is the ASCII encoding of `29 ORPC/1 RES125 exec-A 1 1` followed by byte `0A`, then body bytes `00 FF 0A 80`. The header-only display above is not a complete transmitted frame. The embedded LF and invalid UTF-8 body bytes are ordinary content; no escaping is added. Total frame size is 32 bytes, including the three-byte length prefix and SP.

A UTF-8 body can also be split across parts: the character `é` encoded as bytes `C3 A9` may have `C3` in one part and `A9` in the next. Both body fragments are valid ORPC content. The application decodes after concatenation or uses an incremental text decoder.

### 14.5 Duplicate executions cannot be mixed

Two executions of request `125` would produce `ABCD` and `1234`, respectively. The receiver observes:

```text
27 ORPC/1 RES125 exec-A 1 0
AB
```

```text
27 ORPC/1 RES125 exec-B 2 1
34
```

The first frame selects `exec-A`. The second frame is discarded because it belongs to `exec-B`; it does not set the selected execution's final number. The receiver MUST NOT return `AB34`. It waits for part 2 from `exec-A`, or abandons the attempt and requests the resource again when delivery remains incomplete.

Selection works the same way if a final part arrives first: its execution is selected, and only parts from that execution can complete the response.

## 15. Conformance requirements

A conforming implementation MUST validate:

1. Length-prefixed framing counting the entire binary payload, excluding prefix digits and SP; correct handling of split reads, coalesced frames, invalid lengths, and partial EOF.
2. Self-contained requests and no dependency on a persistent ORPC session.
3. Strict ASCII framing/header validation and byte-for-byte body preservation, including NUL, LF, invalid UTF-8, and text code points split across parts.
4. Single-part, empty, and segmented responses.
5. Correct ordering under arbitrary part arrival order.
6. Independent reconstruction of interleaved requests.
7. Identical-duplicate handling and rejection of conflicting parts.
8. Detection of conflicting final positions and parts beyond the final position.
9. No successful completion with missing parts or a missing final marker.
10. Automatic whole-request recovery with a fresh identifier and no cross-attempt concatenation.
11. Finite retry policy, cancellation, and explicit terminal failure.
12. Application-level safety under repeated execution.
13. Bounded resources and fair transmission under backpressure.
14. Opaque treatment of application successes and errors.
15. Rejection of malformed frames and unsupported versions.
16. Selection of one execution on the first valid response frame, including a final part arriving first.
17. No content mixing, deadline extension, or final-marker updates from other executions of the same request.
18. Fresh execution identifiers for re-executed requests across server instances, without requiring persistent protocol state.
19. Bidirectional event calls with a final response, including application-defined `OK` or empty acknowledgment content.
20. Safe event redelivery after a lost acknowledgment, preserving the application event identifier while changing the request identifier, without acknowledging a `RES`.
21. Binary WebSocket frames for direct WebSocket bindings, and lossless full-frame adaptation before parsing on text-only bindings.
22. Byte-for-byte reconstruction when body bytes are not valid text, and correct application-level incremental text decoding across part boundaries.

## 16. Draft 1 boundaries

Draft 1 intentionally does not define:

- Persistent sessions or stored transfer resumption.
- JSON merge verbs or application error envelopes.
- Exactly-once execution.
- Selective retransmission, per-part transport acknowledgments, or missing-part requests. Application-level notification acknowledgment uses ordinary responses as specified in Section 7.1.
- Segmented request bodies.
- Wire-level cancellation, capability negotiation, or protocol-error frames.

These require a later specification. Implementations MUST NOT silently assume them when claiming Draft 1 interoperability.

## 17. Draft status

This is Draft 1 of ORPC/1, under active development. Earlier working notes were not separate published protocol versions. This draft includes length-prefixed binary framing with ASCII headers, execution-isolated reconstruction, and acknowledged bidirectional notifications. Content is not restricted to UTF-8; this clarification remains part of Draft 1, not a new protocol version.

The experimental `ORPC/1` marker does not imply a stable wire contract. Peers MUST agree on the same specification snapshot outside the protocol and MUST NOT infer optional header fields or accept older unprefixed framing. Requests remain single-frame, and `ABORT` and `CANCEL` remain outside this draft.
