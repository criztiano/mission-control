import { runMigrations } from './migrations';
import { runCCMigrations } from './cc-db';
import { eventBus } from './event-bus';
import { hashPassword } from './password';
import { logger } from './logger';
import { db } from '@/db/client';
import {
  activities,
  notifications,
  taskSubscriptions,
  agents,
  auditLog,
  provisionEvents,
  users,
} from '@/db/schema';
import { eq, desc, isNull, sql } from 'drizzle-orm';

/**
 * @deprecated Use db from @/db/client directly with Drizzle queries.
 * Returns `any` for backward compatibility during migration — will be removed after Phase 3.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDatabase(): any {
  // This is a migration shim. Routes should be updated to use db from @/db/client.
  // For now, return an object that will throw helpful errors if misused.
  const handler = {
    prepare: (_sql: string) => {
      throw new Error(
        'getDatabase().prepare() is deprecated. Migrate this route to use Drizzle (db from @/db/client).'
      );
    },
    exec: (_sql: string) => {
      throw new Error('getDatabase().exec() is deprecated. Use Drizzle (db from @/db/client).');
    },
  };
  return handler;
}

/**
 * No-op: database connection managed by Neon serverless.
 */
export function closeDatabase() {
  // No-op: Neon serverless connections are stateless
}

// Type definitions for database entities (kept for import compat)
export interface Task {
  id: number | string;
  title: string;
  description?: string;
  status: 'draft' | 'open' | 'closed';
  column: 'drafts' | 'open' | 'closed';
  badge: 'idea' | 'proposal' | null;
  priority: 'low' | 'medium' | 'high';
  assigned_to?: string;
  creator?: string;
  created_at: number;
  updated_at: number;
  tags?: string; // JSON string
  metadata?: string; // JSON string
  project_id?: string;
  project_title?: string;
}

export interface Agent {
  id: number;
  name: string;
  role: string;
  session_key?: string;
  soul_content?: string;
  status: 'offline' | 'idle' | 'busy' | 'error';
  last_seen?: number;
  last_activity?: string;
  created_at: number;
  updated_at: number;
  config?: string; // JSON string
}

export interface Comment {
  id: number;
  task_id: number;
  author: string;
  content: string;
  created_at: number;
  parent_id?: number;
  mentions?: string; // JSON string
}

export interface Activity {
  id: number;
  type: string;
  entity_type: string;
  entity_id: number;
  actor: string;
  description: string;
  data?: string; // JSON string
  created_at: number;
}

export interface Message {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent?: string;
  content: string;
  message_type: string;
  metadata?: string; // JSON string
  read_at?: number;
  created_at: number;
}

export interface Notification {
  id: number;
  recipient: string;
  type: string;
  title: string;
  message: string;
  source_type?: string;
  source_id?: number;
  read_at?: number;
  delivered_at?: number;
  created_at: number;
}

export interface Tenant {
  id: number;
  slug: string;
  display_name: string;
  linux_user: string;
  plan_tier: string;
  status: 'pending' | 'provisioning' | 'active' | 'suspended' | 'error';
  openclaw_home: string;
  workspace_root: string;
  gateway_port?: number;
  dashboard_port?: number;
  config?: string;
  created_by: string;
  owner_gateway?: string;
  created_at: number;
  updated_at: number;
}

export interface ProvisionJob {
  id: number;
  tenant_id: number;
  job_type: 'bootstrap' | 'update' | 'decommission';
  status: 'queued' | 'approved' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  dry_run: 0 | 1;
  requested_by: string;
  approved_by?: string;
  runner_host?: string;
  idempotency_key?: string;
  request_json?: string;
  plan_json?: string;
  result_json?: string;
  error_text?: string;
  started_at?: number;
  completed_at?: number;
  created_at: number;
  updated_at: number;
}

export interface ProvisionEvent {
  id: number;
  job_id: number;
  level: 'info' | 'warn' | 'error';
  step_key?: string;
  message: string;
  data?: string;
  created_at: number;
}

// Database helper functions — now async with Drizzle
export const db_helpers = {
  /**
   * Log an activity to the activity stream
   */
  logActivity: async (type: string, entity_type: string, entity_id: number, actor: string, description: string, data?: any) => {
    const result = await db
      .insert(activities)
      .values({
        type,
        entity_type,
        entity_id,
        actor,
        description,
        data: data ? JSON.stringify(data) : null,
        created_at: Math.floor(Date.now() / 1000),
      })
      .returning({ id: activities.id });

    const activityPayload = {
      id: result[0]?.id,
      type,
      entity_type,
      entity_id,
      actor,
      description,
      data: data || null,
      created_at: Math.floor(Date.now() / 1000),
    };

    eventBus.broadcast('activity.created', activityPayload);
  },

  /**
   * Create notification for @mentions
   */
  createNotification: async (recipient: string, type: string, title: string, message: string, source_type?: string, source_id?: number) => {
    const result = await db
      .insert(notifications)
      .values({
        recipient,
        type,
        title,
        message,
        source_type: source_type ?? null,
        source_id: source_id ?? null,
        created_at: Math.floor(Date.now() / 1000),
      })
      .returning({ id: notifications.id });

    const notificationPayload = {
      id: result[0]?.id,
      recipient,
      type,
      title,
      message,
      source_type: source_type || null,
      source_id: source_id || null,
      created_at: Math.floor(Date.now() / 1000),
    };

    eventBus.broadcast('notification.created', notificationPayload);

    return result[0];
  },

  /**
   * Parse @mentions from text
   */
  parseMentions: (text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  },

  /**
   * Update agent status and last seen
   */
  updateAgentStatus: async (agentName: string, status: Agent['status'], activity?: string) => {
    const now = Math.floor(Date.now() / 1000);

    // Get agent ID before update
    const agentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, agentName))
      .limit(1);
    const agent = agentRows[0];

    await db
      .update(agents)
      .set({ status, last_seen: now, last_activity: activity, updated_at: now })
      .where(eq(agents.name, agentName));

    if (agent) {
      eventBus.broadcast('agent.status_changed', {
        id: agent.id,
        name: agentName,
        status,
        last_seen: now,
        last_activity: activity || null,
      });
    }

    await db_helpers.logActivity(
      'agent_status_change',
      'agent',
      agent?.id || 0,
      agentName,
      `Agent status changed to ${status}`,
      { status, activity }
    );
  },

  /**
   * Get recent activities for feed
   */
  getRecentActivities: async (limit: number = 50): Promise<Activity[]> => {
    const rows = await db
      .select()
      .from(activities)
      .orderBy(desc(activities.created_at))
      .limit(limit);
    return rows as Activity[];
  },

  /**
   * Get unread notifications for recipient
   */
  getUnreadNotifications: async (recipient: string): Promise<Notification[]> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipient, recipient))
      .orderBy(desc(notifications.created_at));
    // Filter for unread (read_at is null)
    return rows.filter(r => r.read_at == null) as Notification[];
  },

  /**
   * Mark notification as read
   */
  markNotificationRead: async (notificationId: number) => {
    await db
      .update(notifications)
      .set({ read_at: Math.floor(Date.now() / 1000) })
      .where(eq(notifications.id, notificationId));
  },

  /**
   * Ensure an agent is subscribed to a task
   */
  ensureTaskSubscription: async (taskId: number, agentName: string) => {
    if (!agentName) return;
    await db
      .insert(taskSubscriptions)
      .values({ task_id: taskId, agent_name: agentName })
      .onConflictDoNothing();
  },

  /**
   * Get subscribers for a task
   */
  getTaskSubscribers: async (taskId: number): Promise<string[]> => {
    const rows = await db
      .select({ agent_name: taskSubscriptions.agent_name })
      .from(taskSubscriptions)
      .where(eq(taskSubscriptions.task_id, taskId));
    return rows.map(r => r.agent_name);
  },
};

/**
 * Log a security/admin audit event
 */
export async function logAuditEvent(event: {
  action: string;
  actor: string;
  actor_id?: number;
  target_type?: string;
  target_id?: number;
  detail?: any;
  ip_address?: string;
  user_agent?: string;
}) {
  await db.insert(auditLog).values({
    action: event.action,
    actor: event.actor,
    actor_id: event.actor_id ?? null,
    target_type: event.target_type ?? null,
    target_id: event.target_id ?? null,
    detail: event.detail ? JSON.stringify(event.detail) : null,
    ip_address: event.ip_address ?? null,
    user_agent: event.user_agent ?? null,
    created_at: Math.floor(Date.now() / 1000),
  });

  // Broadcast audit events (webhooks listen here too)
  const securityEvents = ['login_failed', 'user_created', 'user_deleted', 'password_change'];
  if (securityEvents.includes(event.action)) {
    eventBus.broadcast('audit.security', {
      action: event.action,
      actor: event.actor,
      target_type: event.target_type ?? null,
      target_id: event.target_id ?? null,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}

export async function appendProvisionEvent(event: {
  job_id: number;
  level?: 'info' | 'warn' | 'error';
  step_key?: string;
  message: string;
  data?: any;
}) {
  await db.insert(provisionEvents).values({
    job_id: event.job_id,
    level: event.level || 'info',
    step_key: event.step_key ?? null,
    message: event.message,
    data: event.data ? JSON.stringify(event.data) : null,
    created_at: Math.floor(Date.now() / 1000),
  });
}

export async function seedAdminUserFromEnv(): Promise<void> {
  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(users);
  const count = Number(countRows[0]?.count ?? 0);
  if (count > 0) return;

  const username = process.env.AUTH_USER || 'admin';
  const password = process.env.AUTH_PASS || 'admin';
  const displayName = username.charAt(0).toUpperCase() + username.slice(1);

  await db.insert(users).values({
    username,
    display_name: displayName,
    password_hash: hashPassword(password),
    role: 'admin',
  });

  logger.info(`Seeded admin user: ${username}`);
}

// Initialize on module load (server-side only)
if (typeof window === 'undefined') {
  // Schema is managed by drizzle-kit — no need to run migrations on startup
  // Seed admin user asynchronously if no users exist
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    // Initialize webhook event listener (once)
    import('./webhooks').then(({ initWebhookListener }) => {
      initWebhookListener();
    }).catch(() => {
      // Silent - webhooks are optional
    });

    // Start built-in scheduler
    import('./scheduler').then(({ initScheduler }) => {
      initScheduler();
    }).catch(() => {
      // Silent - scheduler is optional
    });
  }
}
