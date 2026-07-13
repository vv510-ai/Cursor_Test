"use client";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4";

export default function CinematicBackground({ subdued = false }: { subdued?: boolean }) {
  return (
    <div className="cinematic-background" aria-hidden>
      <video
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={`cinematic-video ${subdued ? "cinematic-video--subdued" : ""}`}
      />
    </div>
  );
}
