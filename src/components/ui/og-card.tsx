'use client'

import { useState, useEffect } from 'react'
import { Button } from './button'

interface OGData {
  title: string | null
  description: string | null
  image: string | null
  url: string
}

interface OGCardProps {
  url: string
}

export function OGCard({ url }: OGCardProps) {
  const [data, setData] = useState<OGData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [imageBroken, setImageBroken] = useState(false)

  useEffect(() => {
    let mounted = true

    const fetchOGData = async () => {
      try {
        const res = await fetch(`/api/og-preview?url=${encodeURIComponent(url)}`)
        if (!res.ok) {
          if (mounted) setError(true)
          return
        }
        const ogData = await res.json()
        if (mounted) {
          setData(ogData)
        }
      } catch (err) {
        if (mounted) setError(true)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchOGData()

    return () => {
      mounted = false
    }
  }, [url])

  // Don't render if loading failed or no useful data
  if (error || (!loading && (!data || (!data.title && !data.description && !data.image)))) {
    return null
  }

  // Loading state - small spinner
  if (loading) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-1 animate-pulse">
        <div className="w-20 h-20 flex-shrink-0 rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-3/4" />
          <div className="h-3 bg-muted rounded w-full" />
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block transition-all hover:border-foreground/20"
    >
      <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-1 hover:bg-surface-1/80 transition-colors">
        {/* Image */}
        {data.image && !imageBroken && (
          <div className="w-20 h-20 flex-shrink-0 rounded overflow-hidden bg-muted">
            <img
              src={data.image}
              alt=""
              onError={() => setImageBroken(true)}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Text content */}
        <div className="flex-1 min-w-0">
          {data.title && (
            <div className="font-medium text-sm text-foreground mb-1 line-clamp-2">
              {data.title}
            </div>
          )}
          {data.description && (
            <div className="text-xs text-muted-foreground line-clamp-2">
              {data.description}
            </div>
          )}
          {/* URL domain */}
          <div className="text-[10px] text-muted-foreground/60 mt-1 truncate">
            {new URL(data.url).hostname}
          </div>
        </div>

        {/* External link icon */}
        <div className="flex-shrink-0 text-muted-foreground/40 text-xs">
          ↗
        </div>
      </div>
    </a>
  )
}
