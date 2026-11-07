"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type MotionPreviewProps = {
  kind: "hero" | "booking";
  description: string;
  className?: string;
  priority?: boolean;
};

const sources = {
  hero: {
    poster: "/motion/glowflow-hero-loop-poster.jpg",
    webm: "/motion/glowflow-hero-loop.webm",
    mp4: "/motion/glowflow-hero-loop.mp4",
    mobileMp4: "/motion/glowflow-hero-loop-960.mp4",
  },
  booking: {
    poster: "/motion/glowflow-booking-flow-poster.jpg",
    webm: "/motion/glowflow-booking-flow.webm",
    mp4: "/motion/glowflow-booking-flow.mp4",
  },
} as const;

export function MotionPreview({ kind, description, className = "", priority = false }: MotionPreviewProps) {
  const [motionAllowed, setMotionAllowed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = sources[kind];

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setMotionAllowed(!preference.matches);
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !motionAllowed) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !document.hidden) {
        void video.play().catch(() => {
          // The poster remains visible when a browser blocks autoplay.
        });
      } else {
        video.pause();
      }
    }, { threshold: 0.2 });
    observer.observe(video);

    const pauseWhenHidden = () => {
      if (document.hidden) video.pause();
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      video.pause();
    };
  }, [motionAllowed]);

  return <div className={`relative overflow-hidden ${className}`}>
    {motionAllowed ? <video
      ref={videoRef}
      className="block h-full w-full object-cover"
      aria-label={description}
      muted
      loop
      playsInline
      preload="none"
      poster={source.poster}
    >
      {kind === "hero" ? <source src={sources.hero.mobileMp4} media="(max-width: 640px)" type="video/mp4" /> : null}
      <source src={source.webm} type="video/webm" />
      <source src={source.mp4} type="video/mp4" />
    </video> : <Image src={source.poster} alt={description} fill priority={priority} sizes={kind === "hero" ? "(max-width: 1024px) 100vw, 45vw" : "(max-width: 1024px) 80vw, 360px"} className="object-cover" />}
  </div>;
}
