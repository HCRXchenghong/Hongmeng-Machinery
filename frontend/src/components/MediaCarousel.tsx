import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { localizeReact, useLocale } from '../i18n';

export type StoreMedia = string | {
  url?: string;
  src?: string;
  type?: 'image' | 'video';
  muted?: boolean;
  autoplay?: boolean;
  youtubeLink?: string;
};

type Slide = { url: string; type: 'image' | 'video'; muted: boolean; autoplay: boolean; youtubeLink?: string };

function normalizeMedia(media?: StoreMedia[] | StoreMedia | null): Slide[] {
  const values = Array.isArray(media) ? media : media ? [media] : [];
  return values.map((entry) => {
    const value = typeof entry === 'string' ? { url: entry } : entry;
    const url = String(value?.url || value?.src || '').trim();
    if (!url) return null;
    const isYouTube = Boolean(youtubeDetails(url));
    const type = value.type || (isYouTube || /\.(mp4|webm|mov|m3u8|ogg)(?:$|[?#])/i.test(url) ? 'video' : 'image');
    return { url, type, muted: value.muted !== false, autoplay: value.autoplay === true, youtubeLink: value.youtubeLink } as Slide;
  }).filter((item): item is Slide => Boolean(item));
}

function youtubeDetails(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com') && host !== 'youtube-nocookie.com' && !host.endsWith('.youtube-nocookie.com') && host !== 'youtu.be' && !host.endsWith('.youtu.be')) return null;
    const id = host === 'youtu.be' ? parsed.pathname.split('/').filter(Boolean)[0]
      : parsed.pathname === '/watch' ? parsed.searchParams.get('v')
      : parsed.pathname.split('/').filter(Boolean).at(-1);
    return id && /^[\w-]{6,}$/.test(id) ? { id, original: url } : null;
  } catch { return null; }
}

export default function MediaCarousel({ media, fallback = [], title = '', className = '', fit = 'cover' }: {
  media?: StoreMedia[] | StoreMedia | null;
  fallback?: StoreMedia[];
  title?: string;
  className?: string;
  fit?: 'cover' | 'contain';
}) {
  const slides = normalizeMedia(media === undefined || media === null ? fallback : media);
  const locale = useLocale();
  const [index, setIndex] = useState(0);
  const [transition, setTransition] = useState<{ previous: number; direction: 'next' | 'prev' } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const active = slides[index];

  useEffect(() => { setIndex(0); setTransition(null); setPlaying(false); }, [slides.length]);
  useEffect(() => { setMuted(active?.muted !== false); setPlaying(false); }, [active?.url, active?.muted]);
  useEffect(() => {
    if (slides.length < 2 || active?.type === 'video') return;
    const timer = window.setTimeout(() => {
      setTransition({ previous: index, direction: 'next' });
      setIndex((index + 1) % slides.length);
    }, 5500);
    return () => window.clearTimeout(timer);
  }, [index, slides.length, active?.type]);
  useEffect(() => {
    if (!transition) return;
    const timer = window.setTimeout(() => setTransition(null), 460);
    return () => window.clearTimeout(timer);
  }, [transition]);

  if (!active) return null;
  const youtube = active.type === 'video' ? youtubeDetails(active.url) : null;
  const change = (next: number, direction: 'next' | 'prev') => {
    const normalized = (next + slides.length) % slides.length;
    if (normalized === index) return;
    setTransition({ previous: index, direction });
    setIndex(normalized);
    setPlaying(false);
  };
  const playVideo = () => {
    setPlaying(true);
    if (active.type === 'video' && !youtube) videoRef.current?.play().catch(() => setPlaying(false));
  };

  const previous = transition ? slides[transition.previous] : null;
  const slideImages = active.type === 'image' && previous?.type === 'image';
  return localizeReact(<div className={`hm-media-carousel ${fit === 'contain' ? 'is-contain' : ''} ${className}`} aria-label={title || 'Media gallery'}
    onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null; }}
    onTouchEnd={(event) => {
      const start = touchStart.current;
      const end = event.changedTouches[0];
      touchStart.current = null;
      if (!start || !end || slides.length < 2) return;
      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      change(index + (dx < 0 ? 1 : -1), dx < 0 ? 'next' : 'prev');
    }} onTouchCancel={() => { touchStart.current = null; }}>
    {slideImages && transition && previous && <img key={`previous-${transition.previous}`} className={`hm-media-carousel-image hm-media-slide hm-media-leave-${transition.direction}`} src={previous.url} alt="" aria-hidden="true" />}
    {active.type === 'image'
      ? <img key={`active-${index}`} className={`hm-media-carousel-image hm-media-slide ${slideImages ? `hm-media-enter-${transition?.direction}` : ''}`} src={active.url} alt={title} loading="lazy" />
      : youtube
        ? <iframe className="hm-media-carousel-video" src={`https://www.youtube-nocookie.com/embed/${youtube.id}?playsinline=1&rel=0&autoplay=${active.autoplay || playing ? 1 : 0}&mute=${muted ? 1 : 0}&controls=1`} title={title || 'YouTube video'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        : <video ref={videoRef} className="hm-media-carousel-video" src={active.url} controls autoPlay={active.autoplay} muted={muted} loop={active.autoplay} playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />}
    {youtube && <a className="hm-media-youtube-link" href={active.youtubeLink || youtube.original} target="_blank" rel="noreferrer">Watch on YouTube</a>}
    {active.type === 'video' && !active.autoplay && !playing && <button className="hm-media-play" type="button" onClick={playVideo} aria-label="Play video">▶</button>}
    {active.type === 'video' && <button className="hm-media-mute" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>}
    {slides.length > 1 && <>
      <button className="hm-media-arrow prev" type="button" onClick={() => change(index - 1, 'prev')} aria-label="Previous media"><ChevronLeft size={21} /></button>
      <button className="hm-media-arrow next" type="button" onClick={() => change(index + 1, 'next')} aria-label="Next media"><ChevronRight size={21} /></button>
      <div className="hm-media-dots" aria-label="Choose media">
        {slides.map((slide, dotIndex) => <button key={`${slide.url}-${dotIndex}`} type="button" className={dotIndex === index ? 'active' : ''} onClick={() => change(dotIndex, dotIndex > index ? 'next' : 'prev')} aria-label={`Show item ${dotIndex + 1}`} />)}
      </div>
    </>}
  </div>, locale);
}
