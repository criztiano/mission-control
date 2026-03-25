import { NextRequest, NextResponse } from 'next/server';
import { getOGCache, setOGCache } from '@/lib/og-cache';
import { logger } from '@/lib/logger';
import { requireRole } from '@/lib/auth';

// Simple in-memory rate limiter
const fetchTimestamps: number[] = [];
const RATE_LIMIT_MS = 1000; // 1 second between fetches

function checkRateLimit(): boolean {
  const now = Date.now();
  // Clean old timestamps (> 5 seconds old)
  while (fetchTimestamps.length > 0 && now - fetchTimestamps[0] > 5000) {
    fetchTimestamps.shift();
  }

  // Check if last fetch was within rate limit
  if (fetchTimestamps.length > 0 && now - fetchTimestamps[fetchTimestamps.length - 1] < RATE_LIMIT_MS) {
    return false;
  }

  fetchTimestamps.push(now);
  return true;
}

async function fetchOGData(url: string): Promise<{ title: string | null; description: string | null; image: string | null }> {
  try {
    // Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MissionControl/1.0; +https://mission-control)',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Parse OG tags
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || null;
    const ogDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || null;
    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || null;

    // Try alternate tag order (content before property)
    const titleAlt = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i)?.[1];
    const descAlt = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["'][^>]*>/i)?.[1];
    const imageAlt = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["'][^>]*>/i)?.[1];

    return {
      title: ogTitle || titleAlt || null,
      description: ogDescription || descAlt || null,
      image: ogImage || imageAlt || null,
    };
  } catch (error) {
    logger.warn(`Failed to fetch OG data for ${url}: ${error}`);
    return { title: null, description: null, image: null };
  }
}

export async function GET(request: NextRequest) {
  // Auth check
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = request.nextUrl.searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    // Check cache first
    const cached = await getOGCache(url);
    if (cached) {
      logger.info(`OG cache hit: ${url}`);
      return NextResponse.json({
        url: cached.url,
        title: cached.title,
        description: cached.description,
        image: cached.image,
        cached: true,
      });
    }

    // Rate limit check
    if (!checkRateLimit()) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Fetch OG data
    logger.info(`Fetching OG data: ${url}`);
    const ogData = await fetchOGData(url);

    // Save to cache
    await setOGCache(url, ogData);

    return NextResponse.json({
      url,
      title: ogData.title,
      description: ogData.description,
      image: ogData.image,
      cached: false,
    });
  } catch (error) {
    logger.error({ err: error }, 'OG preview error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
