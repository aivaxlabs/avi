# ORPC/1 — Ordered Remote Procedure Call

**Status:** Draft 2 — experimental

**Encoding:** ASCII framing and headers; opaque binary content

**State model:** Stateless between completed operations

[Project overview](README.md) · [Changelog](CHANGELOG.md) · [Repository](https://github.com/aivaxlabs/orpc) · [MIT License](LICENSE)

## 1. Purpose

ORPC exchanges potentially large finite binary application payloads over reliable ordered byte streams or transports delivering complete frames with integrity.

Both requests and responses may be segmented into numbered parts. Multiple operations may share one channel and their frames may be interleaved. Receivers reconstruct each operation independently and complete only after every part through the declared final part has been received.

ORPC is opaque to application content. It does not distinguish text, JSON, files, successful results, or application errors.

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative requirements.

## 2. Stateless model

ORPC is stateless between completed operations. It defines no persistent protocol session, server-side transfer cursor, replay cache, or partial-transfer resume mechanism.

Implementations MAY retain temporary state while an operation is active, including received parts, ordering state, cancellation state, integrity state, and outgoing response state. That state MUST be released when the operation completes, is cancelled, or is abandoned.

Recovery never resumes selected missing parts. A failed operation is retried as a new operation with a fresh base identifier.

## 3. Transport contract

ORPC MUST run over either:

1. a reliable ordered byte stream; or
2. a binding that delivers complete ORPC frames with integrity.

TCP, STDIO pipes, and stream-oriented Unix sockets can carry ORPC directly. Reads may contain partial frames or multiple frames; the length prefix defines boundaries.

For message-oriented transports such as WebSocket or queues, each delivered transport message MUST contain exactly one complete length-prefixed ORPC frame. A direct WebSocket binding MUST use binary messages.

A complete-frame binding MAY reorder, duplicate, or lose frames. ORPC orders request and response parts by their part number. It does not reorder bytes inside an individual frame.

Bindings define authentication, authorization context, routing, confidentiality, backpressure, accepted frame sizes, and transport lifecycle.

## 4. Encoding and content

A frame is:

~~~text
<length> SP <payload>
<payload> = <header> LF <content>
~~~

length counts all payload bytes, including the internal header and LF separator, but excludes the decimal prefix digits and the separating SP.

The header and framing are ASCII. Content is an arbitrary byte sequence and MAY contain any byte value, including NUL, LF, and invalid UTF-8.

Receivers MUST preserve body bytes exactly. ORPC performs no automatic text decoding, Base64 conversion, schema parsing, or content-type handling.

## 5. Identifiers

The identifier grammar is:

~~~text
base-id = [0-9a-zA-Z_.@]+
control = #[0-9A-Z]+

id =
    <base-id>
  | <base-id><control>
  | <control>
~~~

A base-id MUST NOT contain #.

A control identifier MUST begin with #.

Application-generated request identifiers MUST use only base-id.

Identifiers containing a control suffix are reserved by ORPC.

An identifier consisting only of a control is a global control identifier.

One base-id identifies one active logical operation and correlates its request, response, and operation-scoped controls.

A sender MUST use a base-id that is not already active for each new operation. Senders SHOULD generate fresh collision-resistant base identifiers and SHOULD avoid historical reuse because delayed frames can otherwise be confused with a later operation.

An ORPC request identifier MUST NOT be used as the application's persistent idempotency token.

## 6. Frame format

### 6.1 Request

~~~text
<length> ORPC/1 REQ<id> <method> <part> <final>
<content>
~~~

Example:

~~~text
37 ORPC/1 REQ125 archive.read 1 1
foobar
~~~

REQ and id form one token without an intervening space.

method is an application-defined routing name, except for requests using reserved control identifiers as defined below.

part is a one-based positive decimal integer.

final is exactly 0 or 1.

final=1 declares that the current part number is the final part number for that request transfer.

A single-part request uses 1 1.

### 6.2 Response

~~~text
<length> ORPC/1 RES<id> <part> <final>
<content>
~~~

Example:

~~~text
23 ORPC/1 RES125 1 0
Hello
~~~

~~~text
24 ORPC/1 RES125 2 1
 world
~~~

The reconstructed response is exactly Hello world.

A single-part response uses 1 1.

### 6.3 Multipart semantics

Part numbers MUST begin at 1 and form one logical sequence for the transfer.

Receiving final=1 does not complete a transfer unless every part from 1 through that final part number has been received and validated.

Bodies are reconstructed as:

~~~text
body_part_1 || body_part_2 || ... || body_part_N
~~~

with no inserted bytes.

A sender MAY split content at any byte boundary, including within a UTF-8 code point or application record.

Identical duplicate parts MAY be ignored. Conflicting duplicates MUST invalidate the affected transfer.

A receiver MUST reject contradictory final positions or parts beyond a known final position.

## 7. Correlation and multiplexing

Frames for different base identifiers MAY be interleaved freely.

The receiver MUST maintain request and response reconstruction state independently for each active operation.

A new REQ using a base-id that is already active MUST NOT replace, merge with, or restart the active operation. The new request is discarded and the receiver MUST return the LOCKED control described in Section 8.

New operations MUST use new active identifiers. Reusing an inactive historical identifier is not required to be rejected, but implementations SHOULD avoid reuse and MAY retain recently closed identifiers for additional protection against delayed frames.

## 8. Operation-scoped controls

An operation-scoped control uses:

~~~text
<base-id>#<control>
~~~

The suffix is part of the ORPC control namespace, not part of the application-generated base-id.

Control frames still use the ordinary REQ or RES grammar. When a REQ uses a reserved control identifier, its method MUST be 0 and it MUST use part 1 and final 1.

### 8.1 CANCEL

~~~text
<base-id>#CANCEL
~~~

CANCEL requests cancellation of the entire active operation, including further delivery of request or response content.

It requires a corresponding CANCELACK from the other peer.

Example:

~~~text
27 ORPC/1 REQ125#CANCEL 0 1 1

28 ORPC/1 RES125#CANCELACK 1 1
~~~

Cancellation acknowledgement means cancellation was accepted and further delivery will stop when possible. It does not guarantee that every underlying application action was physically interruptible.

### 8.2 CANCELACK

~~~text
<base-id>#CANCELACK
~~~

CANCELACK confirms receipt and acceptance of CANCEL. It does not require another response.

### 8.3 CHECKSEND

~~~text
<base-id>#CHECKSEND
~~~

CHECKSEND carries one or more integrity hashes for the complete reconstructed content immediately preceding it in the same direction for the same base-id.

The hash MUST cover only the complete reconstructed body bytes, in logical part order:

~~~text
hash(body_part_1 || body_part_2 || ... || body_part_N)
~~~

It MUST NOT include ORPC headers, length prefixes, part metadata, or the CHECKSEND frame itself.

The body format is:

~~~text
<algorithm>:<hash>;<algorithm>:<hash>;...
~~~

CHECKSEND MAY be sent by either peer after a complete request or response transfer. CHECKSEND itself MUST NOT recursively require another CHECKSEND.

The recipient MUST answer with CHECKOK or CHECKFAIL.

### 8.4 CHECKOK

~~~text
<base-id>#CHECKOK
~~~

CHECKOK indicates that the preceding CHECKSEND validated successfully. It requires no response.

### 8.5 CHECKFAIL

~~~text
<base-id>#CHECKFAIL
~~~

CHECKFAIL indicates that the preceding CHECKSEND did not validate.

The failed transfer MUST be discarded. Recovery MUST retransmit the complete logical content as a new operation using a fresh base-id. Selected-part retransmission is not defined.

### 8.6 RESEND

~~~text
<base-id>#RESEND
~~~

RESEND requests retransmission of the complete logical content because the receiver cannot successfully reconstruct or accept the transfer, including missing parts, unrecoverable ordering state, transport loss, or another transfer-level failure.

RESEND does not request selected parts.

A resend MUST occur as a new operation using a fresh base-id. The previous operation MUST NOT be continued under the old base-id.

A peer receiving RESEND MUST acknowledge receipt using an ordinary response on the RESEND control identifier before the retry is initiated. The acknowledgement body MAY be empty.

### 8.7 LOCKED

~~~text
<base-id>#LOCKED
~~~

LOCKED is sent when a peer receives a new request using a base-id that already has an active operation.

An operation remains active while its request is being reconstructed, while the application is processing it, or while its response is still being delivered.

The colliding request MUST be discarded and MUST NOT affect the existing operation.

The sender MUST retry the rejected request using a fresh base-id.

LOCKED does not require a further response.

## 9. Global controls

A global control identifier consists only of a control token.

For REQ frames using a global control identifier, method MUST be 0, part MUST be 1, and final MUST be 1.

### 9.1 PING and PONG

#PING is a heartbeat request.

The recipient MUST respond with #PONG.

#PONG requires no further response.

Example:

~~~text
22 ORPC/1 REQ#PING 0 1 1

20 ORPC/1 RES#PONG 1 1
~~~

### 9.2 EXIT and BYE

#EXIT requests graceful shutdown of the transport communication.

After sending #EXIT, the initiator SHOULD stop starting new application operations and MUST wait for #BYE before intentionally closing the transport, unless the transport fails first.

#BYE indicates that transport shutdown is imminent. It requires no response.

## 10. Notifications and bidirectional calls

Either peer MAY initiate a call.

An application event notification is an ordinary request in the opposite direction, not a fire-and-forget protocol frame.

Example:

~~~text
97 ORPC/1 REQevt.123 conversation.changed 1 1
{"eventId":"change-456","conversationId":"thread-789"}
~~~

Acknowledgement:

~~~text
24 ORPC/1 RESevt.123 1 1
OK
~~~

OK is an application convention and has no protocol-defined status meaning. An empty final response is also valid.

If an acknowledgement is lost and the application operation is retried, the retry MUST use a fresh ORPC base-id. Applications needing effect deduplication MUST carry their own stable application event or idempotency identifier in the opaque body.

## 11. Ordered reconstruction

Each active request and response transfer MUST be reconstructed independently.

The receiver MUST:

1. accept parts in arbitrary arrival order;
2. buffer or spool out-of-order parts within configured resource limits;
3. ignore only byte-identical duplicates with an identical final flag;
4. reject conflicting duplicates;
5. record the unique final part number when final=1 appears;
6. reject contradictory final positions;
7. complete only after every part from 1 through the final part number is available; and
8. concatenate bodies in ascending part order with no inserted bytes.

A receiver MAY expose contiguous provisional content before completion, but it MUST invalidate that provisional content if the transfer is later cancelled or abandoned.

## 12. Reliability and recovery

Each active operation MUST have finite resource and time bounds.

If a request or response cannot be reconstructed completely, the receiver MUST NOT expose the partial body as a complete result.

Recovery may be initiated by timeout, transport failure, CHECKFAIL, RESEND, or another implementation-defined terminal transfer failure.

Every new recovery attempt MUST use a fresh base-id.

ORPC does not guarantee exactly-once execution. Application methods that may be retried MUST be read-only, idempotent, or protected by application-level idempotency handling.

A retry MUST reconstruct the new request and response independently. Content from different base identifiers MUST NOT be combined.

## 13. Cancellation

Either peer MAY cancel an active operation using the operation's base-id with #CANCEL.

After accepting cancellation, the peer MUST stop sending additional content for that operation when possible and MUST release its transient reconstruction or delivery state.

A cancelled operation MUST NOT be automatically retried merely because it was cancelled.

## 14. Integrity

CHECKSEND provides optional end-to-end content-integrity validation at the ORPC layer.

The set of supported algorithm names is implementation- or deployment-defined unless separately standardized.

Algorithm names and hash encodings MUST be compared according to the deployment contract. Implementations SHOULD use algorithms suitable for their integrity requirements.

A plain checksum or unkeyed hash does not authenticate the sender. Deployments requiring protection against malicious modification MUST provide authenticated transport integrity or a separately defined keyed or signed integrity mechanism.

## 15. Limits and backpressure

Implementations MUST enforce documented limits for at least:

- maximum complete frame size;
- maximum active operations;
- maximum part count;
- maximum reconstructed request size;
- maximum reconstructed response size;
- out-of-order buffering or spool usage;
- operation duration and retry budget;
- outgoing queue size; and
- transmission rate.

Implementations MUST avoid allocation proportional to an untrusted part number.

Senders SHOULD schedule ready parts fairly so one large operation does not indefinitely monopolize the channel.

## 16. Security considerations

Request identifiers do not authenticate senders.

The binding and application MUST provide appropriate authentication, authorization, confidentiality, and peer isolation.

Applications MUST treat body content as untrusted input.

Logs SHOULD record identifiers, controls, part numbers, byte counts, timing, and failure reasons without recording sensitive payloads by default.

## 17. Conformance requirements

A conforming ORPC/1 Draft 2 implementation MUST validate at least:

1. byte-length framing and exact payload boundaries;
2. ASCII header parsing;
3. opaque binary body preservation;
4. segmented requests;
5. segmented responses;
6. arbitrary part arrival order;
7. interleaving across base identifiers;
8. duplicate and conflicting-part handling;
9. final-part consistency;
10. no successful completion with missing parts;
11. fresh IDs for new active operations and retries;
12. LOCKED handling for active-ID collisions;
13. operation-wide CANCEL and CANCELACK;
14. CHECKSEND, CHECKOK, and CHECKFAIL semantics;
15. whole-content RESEND semantics with fresh-ID recovery;
16. PING/PONG heartbeat behavior;
17. EXIT/BYE graceful shutdown behavior;
18. bidirectional ordinary application calls;
19. bounded resource use and backpressure; and
20. no dependency on an execution-id field.

## 18. Draft 2 boundaries

Draft 2 intentionally does not define:

- persistent ORPC sessions;
- exactly-once execution;
- selected-part retransmission;
- resumable transfers;
- application schemas;
- application error envelopes;
- compression negotiation;
- flow-control windows;
- capability negotiation; or
- a mandatory checksum algorithm.

## 19. Draft status

This is ORPC/1 Draft 2.

Compared with Draft 1, Draft 2 makes requests multipart, removes execution-id from responses, reserves control namespaces inside the shared identifier space, adds cancellation, integrity verification, whole-transfer resend, active-ID collision handling, heartbeat controls, and graceful transport shutdown controls.

The ORPC/1 marker remains experimental and does not guarantee compatibility between different draft snapshots. Peers MUST agree on a compatible specification snapshot outside the protocol.
