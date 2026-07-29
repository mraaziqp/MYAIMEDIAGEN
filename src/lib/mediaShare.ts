export function filenameFromMediaUrl(mediaUrl: string): string {
  try {
    const url = new URL(mediaUrl, window.location.origin);
    return url.searchParams.get('filename') || 'render';
  } catch {
    return 'render';
  }
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Tries, in order: sharing the actual file via the Web Share API (best - works on mobile
 * and modern desktop browsers), sharing just the URL, then falling back to copying the
 * URL to the clipboard. Returns which of those actually happened so the caller can show
 * the right feedback.
 */
export async function shareMedia(mediaUrl: string): Promise<ShareResult> {
  const absoluteUrl = new URL(mediaUrl, window.location.origin).href;
  const filename = filenameFromMediaUrl(mediaUrl);

  try {
    const res = await fetch(mediaUrl);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'AI Generated Media' });
      return 'shared';
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') return 'cancelled';
  }

  if (navigator.share) {
    try {
      await navigator.share({ url: absoluteUrl, title: 'AI Generated Media' });
      return 'shared';
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    await navigator.clipboard.writeText(absoluteUrl);
    return 'copied';
  } catch {
    return 'failed';
  }
}
