import { db } from '@/db/client'
import { messages } from '@/db/schema'
import { like, count } from 'drizzle-orm'

/**
 * Seed demo agent-to-agent communications for the agent-comms panel.
 * Only seeds once by checking for existing seeded conversations.
 */
export async function seedAgentComms() {
  // Check if already seeded
  const existing = await db
    .select({ count: count() })
    .from(messages)
    .where(like(messages.conversation_id, 'conv-multi-%'))

  if ((existing[0]?.count ?? 0) > 0) {
    return
  }

  const now = Math.floor(Date.now() / 1000)
  const oneHourAgo = now - 3600
  const twoHoursAgo = now - 7200
  const threeDaysAgo = now - 259200

  const demoMessages = [
    { conversation_id: 'conv-multi-001', from_agent: 'coordinator', to_agent: 'builder', content: 'New task assigned: Implement user authentication flow. Priority: high', message_type: 'text', metadata: JSON.stringify({ task_id: 'task-123', priority: 'high' }), created_at: threeDaysAgo },
    { conversation_id: 'conv-multi-002', from_agent: 'builder', to_agent: 'coordinator', content: 'Acknowledged. Starting implementation. ETA: 2 hours', message_type: 'text', metadata: JSON.stringify({ task_id: 'task-123', status: 'in_progress' }), created_at: threeDaysAgo + 300 },
    { conversation_id: 'conv-multi-003', from_agent: 'builder', to_agent: 'security', content: 'Auth implementation ready for security review. Can you check token handling?', message_type: 'text', metadata: JSON.stringify({ task_id: 'task-123', review_type: 'security' }), created_at: twoHoursAgo },
    { conversation_id: 'conv-multi-004', from_agent: 'security', to_agent: 'builder', content: 'Reviewed. Found 2 issues: JWT expiry needs validation, rate limiting missing on login endpoint', message_type: 'text', metadata: JSON.stringify({ issues_found: 2, severity: 'medium' }), created_at: twoHoursAgo + 900 },
    { conversation_id: 'conv-multi-005', from_agent: 'builder', to_agent: 'security', content: 'Fixed both issues. JWT expiry validation added, rate limiter implemented with 5 req/min limit', message_type: 'text', created_at: oneHourAgo },
    { conversation_id: 'conv-multi-006', from_agent: 'security', to_agent: 'builder', content: 'LGTM! Approved for merge', message_type: 'text', metadata: JSON.stringify({ approved: true }), created_at: oneHourAgo + 600 },
    { conversation_id: 'conv-multi-007', from_agent: 'research', to_agent: 'coordinator', content: 'Completed analysis of latest DeFi protocols. Found 3 promising integration opportunities', message_type: 'text', metadata: JSON.stringify({ report_id: 'research-042', findings: 3 }), created_at: oneHourAgo + 1200 },
    { conversation_id: 'conv-multi-008', from_agent: 'coordinator', to_agent: 'quant', content: 'Research found new DeFi opportunities. Can you analyze potential yields?', message_type: 'text', metadata: JSON.stringify({ report_id: 'research-042' }), created_at: oneHourAgo + 1500 },
    { conversation_id: 'conv-multi-009', from_agent: 'quant', to_agent: 'coordinator', content: 'Running yield projections now. Initial APY estimates: 12-18% range', message_type: 'text', metadata: JSON.stringify({ apy_min: 12, apy_max: 18 }), created_at: oneHourAgo + 2100 },
    { conversation_id: 'conv-multi-010', from_agent: 'frontend-dev', to_agent: 'backend-dev', content: 'API response time for /api/portfolio is slow (2.5s). Can we optimize?', message_type: 'text', metadata: JSON.stringify({ endpoint: '/api/portfolio', latency_ms: 2500 }), created_at: now - 3000 },
    { conversation_id: 'conv-multi-011', from_agent: 'backend-dev', to_agent: 'frontend-dev', content: 'Added DB indexes and implemented caching. Now 180ms average. Can you verify?', message_type: 'text', metadata: JSON.stringify({ endpoint: '/api/portfolio', new_latency_ms: 180 }), created_at: now - 1800 },
    { conversation_id: 'conv-multi-012', from_agent: 'frontend-dev', to_agent: 'backend-dev', content: 'Confirmed! Response time now 160-200ms. Huge improvement 🚀', message_type: 'text', metadata: JSON.stringify({ verified: true }), created_at: now - 900 },
    { conversation_id: 'conv-multi-013', from_agent: 'design', to_agent: 'frontend-dev', content: 'Updated dashboard mockups. Key changes: new color palette, refined spacing', message_type: 'text', metadata: JSON.stringify({ mockup_version: 'v2.1' }), created_at: now - 600 },
    { conversation_id: 'conv-multi-014', from_agent: 'frontend-dev', to_agent: 'design', content: 'Looks great! Question: Should cards have 8px or 12px border radius?', message_type: 'text', created_at: now - 300 },
    { conversation_id: 'conv-multi-015', from_agent: 'design', to_agent: 'frontend-dev', content: '12px for consistency with our design system', message_type: 'text', created_at: now - 120 },
  ]

  await db.insert(messages).values(
    demoMessages.map((m) => ({
      conversation_id: m.conversation_id,
      from_agent: m.from_agent,
      to_agent: m.to_agent ?? null,
      content: m.content,
      message_type: m.message_type,
      metadata: (m as any).metadata ?? null,
      created_at: m.created_at,
    }))
  )

  console.log('[seed-comms] Seeded 15 demo agent messages')
}
