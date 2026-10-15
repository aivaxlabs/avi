const HEAD_COUNT = 5;
const TAIL_COUNT = 10;
const PREVIEW_LENGTH = 280;

export function MessageMarkers({ messages, onSelect }) {
  if (messages.length < 2) return null;

  const markers = messages.map((message, index) => {
    const text = (message.content ?? '').trim()
      || (message.attachments ?? []).map((attachment) => attachment.name).join(', ');
    return {
      id: message.id,
      number: index + 1,
      preview: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text,
    };
  });

  const visibleMarkers = markers.length > HEAD_COUNT + TAIL_COUNT
    ? [...markers.slice(0, HEAD_COUNT), null, ...markers.slice(-TAIL_COUNT)]
    : markers;

  return (
    <nav className="message-markers" aria-label="Sent messages">
      {visibleMarkers.map((marker) => (marker ? (
        <button
          key={marker.id}
          type="button"
          aria-label={`Go to message ${marker.number}: ${marker.preview.slice(0, 80)}`}
          onClick={() => onSelect(marker.id)}
        >
          {marker.preview && (
            <span className="message-marker-preview" aria-hidden="true">{marker.preview}</span>
          )}
        </button>
      ) : (
        <span key="gap" className="message-markers-gap" aria-hidden="true" />
      )))}
    </nav>
  );
}
