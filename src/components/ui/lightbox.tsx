"use client";

import * as React from "react";
import { Xmark, NavArrowLeft, NavArrowRight } from "iconoir-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface LightboxProps {
  imageUrl?: string; // Legacy single image prop
  images?: string[]; // Multiple images
  initialIndex?: number; // Starting index for multiple images
  onClose: () => void;
  className?: string;
}

export function Lightbox({ imageUrl, images, initialIndex = 0, onClose, className }: LightboxProps) {
  // Support both single image (legacy) and multiple images
  const imageList = React.useMemo(() => {
    if (images && images.length > 0) return images;
    if (imageUrl) return [imageUrl];
    return [];
  }, [images, imageUrl]);

  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
  const hasMultiple = imageList.length > 1;

  const handlePrevious = React.useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? imageList.length - 1 : prev - 1));
  }, [imageList.length]);

  const handleNext = React.useCallback(() => {
    setCurrentIndex((prev) => (prev === imageList.length - 1 ? 0 : prev + 1));
  }, [imageList.length]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && hasMultiple) {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === "ArrowRight" && hasMultiple) {
        e.preventDefault();
        handleNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    // Prevent body scroll when lightbox is open
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [onClose, hasMultiple, handlePrevious, handleNext]);

  if (imageList.length === 0) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm",
        className
      )}
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]">
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute -top-12 right-0 bg-card/80 hover:bg-card text-foreground"
          title="Close (Esc)"
        >
          <Xmark />
        </Button>

        {/* Image counter (for multiple images) */}
        {hasMultiple && (
          <div className="absolute -top-12 left-0 bg-card/80 px-3 py-1.5 rounded-md text-sm text-foreground">
            {currentIndex + 1} / {imageList.length}
          </div>
        )}

        {/* Navigation buttons (for multiple images) */}
        {hasMultiple && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handlePrevious();
              }}
              className="absolute left-[-60px] top-1/2 -translate-y-1/2 bg-card/80 hover:bg-card text-foreground"
              title="Previous (←)"
            >
              <NavArrowLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-[-60px] top-1/2 -translate-y-1/2 bg-card/80 hover:bg-card text-foreground"
              title="Next (→)"
            >
              <NavArrowRight />
            </Button>
          </>
        )}

        {/* Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageList[currentIndex]}
          alt={`Full size ${hasMultiple ? `${currentIndex + 1} of ${imageList.length}` : ''}`}
          className="max-w-full max-h-[90vh] rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
