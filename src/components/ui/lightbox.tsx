"use client";

import * as React from "react";
import { Xmark } from "iconoir-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface LightboxProps {
  imageUrl: string;
  onClose: () => void;
  className?: string;
}

export function Lightbox({ imageUrl, onClose, className }: LightboxProps) {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    // Prevent body scroll when lightbox is open
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [onClose]);

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

        {/* Image */}
        <img
          src={imageUrl}
          alt="Full size"
          className="max-w-full max-h-[90vh] rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
