import { useEffect, useState } from 'react';

function useAttachmentPreview(attachment) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (attachment?.dataUrl || !attachment?.path) {
      setPreview(null);
      return undefined;
    }

    setPreview(null);
    let active = true;
    let token = null;
    let renewalTimer = null;
    const requestPreview = async () => {
      try {
        const result = await window.chatApp.attachments.preview(attachment);
        if (!active) {
          void window.chatApp.attachments.releasePreview(result.token);
          return;
        }
        const previousToken = token;
        token = result.token;
        setPreview(result);
        if (previousToken) void window.chatApp.attachments.releasePreview(previousToken);
        renewalTimer = setTimeout(
          requestPreview,
          Math.max(1_000, result.expiresAt - Date.now() - 60_000),
        );
      } catch {
        if (active) setPreview(null);
      }
    };
    void requestPreview();

    return () => {
      active = false;
      clearTimeout(renewalTimer);
      if (token) void window.chatApp.attachments.releasePreview(token);
    };
  }, [attachment?.dataUrl, attachment?.path]);

  return attachment?.dataUrl ?? preview?.url;
}

export function AttachmentImage({ attachment, ...props }) {
  const source = useAttachmentPreview(attachment);
  return source ? <img {...props} src={source} /> : null;
}

export function AttachmentVideo({ attachment, ...props }) {
  const source = useAttachmentPreview(attachment);
  return source ? <video {...props} src={source} /> : null;
}
