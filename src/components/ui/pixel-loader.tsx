"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

// Pattern types:
// - Single inner array → sequential (pixels light up one at a time in order)
// - Multiple arrays with 1 value each → toggle (each pixel toggles independently)
// - Multiple arrays with multiple values → frame-by-frame (use frames as-is)

type Pattern = readonly (readonly number[])[] | number[][];

interface PixelLoaderProps {
  /** Animation pattern — array of frames, each frame is array of active pixel indices (0-8) */
  pattern?: Pattern;
  /** Pixel color as CSS color string */
  color?: string;
  /** Overall size in pixels */
  size?: number;
  /** Frame duration in ms */
  speed?: number;
  className?: string;
}

// Built-in patterns
const PATTERNS = {
  // Diagonal sweep
  diagonal: [[0], [1, 3], [2, 4, 6], [5, 7], [8]],
  // Spiral inward
  spiral: [[0], [1], [2], [5], [8], [7], [6], [3], [4]],
  // Corners then center
  corners: [
    [0, 2, 6, 8],
    [1, 3, 5, 7],
    [4],
  ],
  // Wave left to right
  wave: [
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
  ],
} as const;

const DEFAULT_PATTERN = PATTERNS.diagonal;

function normalizePattern(input: Pattern): number[][] {
  if (input.length === 0) return [[0]];

  // Single inner array → sequential: expand to one pixel per frame
  if (input.length === 1 && input[0].length > 1) {
    return Array.from(input[0], (idx) => [idx]);
  }

  // Multiple arrays with 1 value each → toggle mode
  // Create frames: each pixel toggles on, then all off
  if (input.length > 1 && input.every((arr) => arr.length === 1)) {
    const allPixels = Array.from(input, (arr) => arr[0]);
    const frames: number[][] = [];
    for (let i = 0; i <= allPixels.length; i++) {
      frames.push(allPixels.slice(0, i));
    }
    // Add empty frame at end for the blink
    frames.push([]);
    return frames;
  }

  // Frame-by-frame: use as-is
  return input.map((frame) => Array.from(frame));
}

export function PixelLoader({
  pattern = DEFAULT_PATTERN,
  color = "#84cc16", // lime-500
  size = 48,
  speed = 200,
  className,
}: PixelLoaderProps) {
  const [step, setStep] = useState(0);
  const frames = useMemo(() => normalizePattern(pattern), [pattern]);

  // Reset step when pattern changes
  useEffect(() => {
    setStep(0);
  }, [pattern]);

  // Animation loop
  useEffect(() => {
    const frameCount = frames.length;
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % frameCount);
    }, speed);
    return () => clearInterval(interval);
  }, [speed, frames]);

  const activePixels = new Set(frames[step % frames.length]);

  const gap = Math.max(1, Math.round(size * 0.06));
  const pixelSize = (size - gap * 2) / 3;

  const glowSm = `0 0 ${Math.round(pixelSize * 0.4)}px ${color}`;
  const glowMd = `0 0 ${Math.round(pixelSize * 0.8)}px ${color}`;
  const glowLg = `0 0 ${Math.round(pixelSize * 1.2)}px ${color}40`;

  return (
    <div
      className={cn("inline-grid shrink-0", className)}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(3, ${pixelSize}px)`,
        gridTemplateRows: `repeat(3, ${pixelSize}px)`,
        gap: `${gap}px`,
        width: size,
        height: size,
      }}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: 9 }, (_, i) => {
        const isActive = activePixels.has(i);
        return (
          <div
            key={i}
            style={{
              width: pixelSize,
              height: pixelSize,
              borderRadius: Math.max(1, Math.round(pixelSize * 0.15)),
              backgroundColor: isActive ? color : "hsl(240 5% 12%)",
              boxShadow: isActive ? `${glowSm}, ${glowMd}, ${glowLg}` : "none",
              opacity: isActive ? 1 : 0.15,
              transition: `opacity ${speed * 0.4}ms ease, background-color ${speed * 0.4}ms ease, box-shadow ${speed * 0.4}ms ease`,
            }}
          />
        );
      })}
    </div>
  );
}

export { PATTERNS as pixelLoaderPatterns };
