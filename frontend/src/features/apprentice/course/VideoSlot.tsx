interface VideoSlotProps {
  url: string | null;
  title: string;
}

/**
 * The master's video for a lesson. Recording the master on video with the hands overlaid in real time is a future feature,
 * so without a video URL this shows a placeholder frame instead.
 */
export function VideoSlot({ url, title }: VideoSlotProps) {
  if (url) {
    return (
      <div className="ap-video">
        <video className="ap-video__el" src={url} controls preload="metadata" aria-label={`Master video: ${title}`} />
      </div>
    );
  }
  return (
    <div className="ap-video ap-video--empty" role="img" aria-label="The master's video will appear here">
      <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="14" width="40" height="36" rx="3" />
        <path d="M46 28l12-7v22l-12-7z" />
        <path d="M20 26l10 6-10 6z" />
      </svg>
      <p className="ap-video__title">The master&rsquo;s video will appear here</p>
      <p className="note">Filming the master with the hands overlaid in real time is coming soon.</p>
    </div>
  );
}
