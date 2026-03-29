import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getGardenItems, type GardenFilters } from '@/lib/cc-db';
import { db } from '@/db/client';
import { garden } from '@/db/schema';
import { randomUUID } from 'crypto';

/**
 * GET /api/garden - List garden items with filters
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);

    const filters: GardenFilters = {};
    if (searchParams.get('interest')) filters.interest = searchParams.get('interest')!;
    if (searchParams.get('type')) filters.type = searchParams.get('type')!;
    if (searchParams.get('temporal')) filters.temporal = searchParams.get('temporal')!;
    if (searchParams.get('search')) filters.search = searchParams.get('search')!;
    filters.limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    filters.offset = parseInt(searchParams.get('offset') || '0');

    const result = await getGardenItems(filters);

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/garden error');
    return NextResponse.json({ error: 'Failed to fetch garden items' }, { status: 500 });
  }
}

/**
 * POST /api/garden - Create a new garden item
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body = await request.json();

    const { title, content, type, interest, temporal, tags, note, original_source, media_urls, metadata } = body;

    if (!content && !title) {
      return NextResponse.json({ error: 'title or content is required' }, { status: 400 });
    }

    const id = body.id || randomUUID();
    const now = new Date().toISOString();

    await db.insert(garden).values({
      id,
      title: title || '',
      content: content || '',
      type: type || 'note',
      interest: interest || 'information',
      temporal: temporal || 'ever',
      tags: JSON.stringify(tags || []),
      note: note || '',
      original_source: original_source || null,
      media_urls: JSON.stringify(media_urls || []),
      metadata: JSON.stringify(metadata || {}),
      enriched: false,
      instance_type: body.instance_type || 'instance',
      created_at: now,
      saved_at: now,
    });

    logger.info({ id, type: type || 'note', interest: interest || 'information' }, 'Garden item created');

    return NextResponse.json({ success: true, id });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/garden error');
    return NextResponse.json({ error: 'Failed to create garden item' }, { status: 500 });
  }
}
