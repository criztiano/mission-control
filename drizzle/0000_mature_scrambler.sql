CREATE TABLE "digests" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"items" text DEFAULT '[]' NOT NULL,
	"stats" text,
	"stats_scraped" integer DEFAULT 0,
	"stats_kept" integer DEFAULT 0,
	"stats_dropped" integer DEFAULT 0,
	"created_at" text NOT NULL,
	"discord_message_id" text,
	"discord_thread_id" text
);
--> statement-breakpoint
CREATE TABLE "garden" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"type" text DEFAULT 'tweet' NOT NULL,
	"interest" text DEFAULT 'information' NOT NULL,
	"temporal" text DEFAULT 'ever' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"original_source" text,
	"media_urls" text DEFAULT '[]' NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"enriched" boolean DEFAULT false,
	"instance_type" text DEFAULT 'instance' NOT NULL,
	"snooze_until" text,
	"expires_at" text,
	"group" text,
	"created_at" text NOT NULL,
	"saved_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" text DEFAULT '',
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"author" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text NOT NULL,
	"attachments" text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE "issue_dependencies" (
	"issue_id" text NOT NULL,
	"depends_on" text NOT NULL,
	CONSTRAINT "issue_dependencies_issue_id_depends_on_pk" PRIMARY KEY("issue_id","depends_on")
);
--> statement-breakpoint
CREATE TABLE "issue_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text,
	"kind" text NOT NULL,
	"label" text DEFAULT '',
	"value" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '',
	"status" text DEFAULT 'idea' NOT NULL,
	"assignee" text DEFAULT '',
	"priority" text DEFAULT 'normal',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived" boolean DEFAULT false,
	"schedule" text DEFAULT '',
	"parent_id" text,
	"notion_id" text DEFAULT '',
	"creator" text DEFAULT '',
	"plan_path" text,
	"last_turn_at" text,
	"seen_at" text,
	"picked" boolean DEFAULT false,
	"picked_at" text,
	"picked_by" text DEFAULT '',
	"blocked_by" text DEFAULT '[]',
	"plan_id" text
);
--> statement-breakpoint
CREATE TABLE "og_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"image" text,
	"fetched_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"task_id" text,
	"project_id" text,
	"author" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"responses" text DEFAULT '{}' NOT NULL,
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "project_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"content" text NOT NULL,
	"pinned" boolean DEFAULT false,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"label" text DEFAULT '',
	"value" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '',
	"emoji" text DEFAULT '📁',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived" boolean DEFAULT false,
	"schedule" text DEFAULT 'nightly',
	"repo_url" text DEFAULT '',
	"local_path" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"type" text NOT NULL,
	"author" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"links" text DEFAULT '[]',
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "tweet_interactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tweet_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tweet_ratings" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"rating" text NOT NULL,
	"rated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tweets" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"theme" text DEFAULT '' NOT NULL,
	"verdict" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"tweet_link" text DEFAULT '' NOT NULL,
	"digest" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"scraped_at" text NOT NULL,
	"pinned" boolean DEFAULT false,
	"media_urls" text DEFAULT '[]' NOT NULL,
	"triage_status" text DEFAULT 'pending' NOT NULL,
	"snooze_until" text,
	"local_media_urls" text DEFAULT '[]' NOT NULL,
	"discord_message_id" text,
	"discord_posted_at" text,
	"summary" text DEFAULT '' NOT NULL,
	"digest_id" text,
	"highlighted" boolean DEFAULT false,
	"highlight_note" text DEFAULT '',
	"top_replies" text DEFAULT '[]',
	"reply_count" integer DEFAULT 0,
	"retweet_count" integer DEFAULT 0,
	"like_count" integer DEFAULT 0,
	"engage" boolean DEFAULT false,
	"engage_reason" text
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"email" text NOT NULL,
	"provider_user_id" text,
	"display_name" text,
	"avatar_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" integer,
	"last_attempt_at" integer,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" integer,
	"review_note" text,
	"approved_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"actor" text NOT NULL,
	"description" text NOT NULL,
	"data" text,
	"created_at" integer,
	"workspace_id" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "adapter_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"framework" text NOT NULL,
	"config" text DEFAULT '{}',
	"enabled" boolean DEFAULT true,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "agent_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text DEFAULT '[]' NOT NULL,
	"expires_at" integer,
	"revoked_at" integer,
	"last_used_at" integer,
	"created_by" text,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "agent_trust_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"trust_score" real DEFAULT 1 NOT NULL,
	"auth_failures" integer DEFAULT 0 NOT NULL,
	"injection_attempts" integer DEFAULT 0 NOT NULL,
	"rate_limit_hits" integer DEFAULT 0 NOT NULL,
	"secret_exposures" integer DEFAULT 0 NOT NULL,
	"successful_tasks" integer DEFAULT 0 NOT NULL,
	"failed_tasks" integer DEFAULT 0 NOT NULL,
	"last_anomaly_at" integer,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"session_key" text,
	"soul_content" text,
	"status" text DEFAULT 'offline' NOT NULL,
	"last_seen" integer,
	"last_activity" text,
	"created_at" integer,
	"updated_at" integer,
	"config" text,
	"team" text,
	"workspace_id" integer DEFAULT 1,
	"source" text DEFAULT 'manual',
	"content_hash" text,
	"workspace_path" text
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true,
	"entity_type" text NOT NULL,
	"condition_field" text NOT NULL,
	"condition_operator" text NOT NULL,
	"condition_value" text NOT NULL,
	"action_type" text DEFAULT 'notification' NOT NULL,
	"action_config" text DEFAULT '{}' NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_triggered_at" integer,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"scopes" text,
	"expires_at" integer,
	"last_used_at" integer,
	"last_used_ip" text,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"is_revoked" boolean DEFAULT false,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"actor_id" integer,
	"target_type" text,
	"target_id" integer,
	"detail" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "claude_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"project_path" text,
	"model" text,
	"git_branch" text,
	"user_messages" integer DEFAULT 0 NOT NULL,
	"assistant_messages" integer DEFAULT 0 NOT NULL,
	"tool_uses" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"first_message_at" text,
	"last_message_at" text,
	"last_user_prompt" text,
	"is_active" boolean DEFAULT false,
	"scanned_at" integer NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"author" text NOT NULL,
	"content" text NOT NULL,
	"created_at" integer,
	"parent_id" integer,
	"mentions" text
);
--> statement-breakpoint
CREATE TABLE "direct_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"tool_name" text NOT NULL,
	"tool_version" text,
	"connection_id" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_heartbeat" integer,
	"metadata" text,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "eval_golden_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entries" text DEFAULT '[]' NOT NULL,
	"created_by" text,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"eval_layer" text NOT NULL,
	"score" real,
	"passed" boolean,
	"detail" text,
	"golden_dataset_id" integer,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "eval_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"task_id" integer,
	"trace" text DEFAULT '[]' NOT NULL,
	"convergence_score" real,
	"total_steps" integer,
	"optimal_steps" integer,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "gateway_health_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"gateway_id" integer NOT NULL,
	"status" text NOT NULL,
	"latency" integer,
	"probed_at" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "gateways" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" text DEFAULT '127.0.0.1' NOT NULL,
	"port" integer DEFAULT 18789 NOT NULL,
	"token" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_seen" integer,
	"latency" integer,
	"sessions_count" integer DEFAULT 0 NOT NULL,
	"agents_count" integer DEFAULT 0 NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "github_syncs" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"last_synced_at" integer,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"sync_direction" text DEFAULT 'inbound' NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"error" text,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"project_id" integer,
	"changes_pushed" integer DEFAULT 0 NOT NULL,
	"changes_pulled" integer DEFAULT 0 NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "mcp_call_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text,
	"mcp_server" text,
	"tool_name" text,
	"success" boolean DEFAULT true,
	"duration_ms" integer,
	"error" text,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"from_agent" text NOT NULL,
	"to_agent" text,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'text',
	"metadata" text,
	"read_at" integer,
	"created_at" integer,
	"workspace_id" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"source_type" text,
	"source_id" integer,
	"read_at" integer,
	"delivered_at" integer,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"steps_snapshot" text DEFAULT '[]' NOT NULL,
	"started_at" integer,
	"completed_at" integer,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "project_agent_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"agent_name" text NOT NULL,
	"role" text DEFAULT 'member',
	"assigned_at" integer
);
--> statement-breakpoint
CREATE TABLE "provision_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"step_key" text,
	"message" text NOT NULL,
	"data" text,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "provision_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"job_type" text DEFAULT 'bootstrap' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"dry_run" boolean DEFAULT true,
	"requested_by" text DEFAULT 'system' NOT NULL,
	"approved_by" text,
	"runner_host" text,
	"idempotency_key" text,
	"request_json" text DEFAULT '{}' NOT NULL,
	"plan_json" text DEFAULT '[]' NOT NULL,
	"result_json" text,
	"error_text" text,
	"started_at" integer,
	"completed_at" integer,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "quality_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"reviewer" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "schema_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" integer
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"source" text,
	"agent_name" text,
	"detail" text,
	"ip_address" text,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"updated_by" text,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"path" text NOT NULL,
	"description" text,
	"content_hash" text,
	"registry_slug" text,
	"registry_version" text,
	"security_status" text DEFAULT 'unchecked',
	"installed_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "standup_reports" (
	"date" text PRIMARY KEY NOT NULL,
	"report" text NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "task_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"agent_name" text NOT NULL,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assigned_to" text,
	"creator" text DEFAULT '',
	"created_at" integer,
	"updated_at" integer,
	"tags" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"linux_user" text NOT NULL,
	"plan_tier" text DEFAULT 'standard' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"openclaw_home" text NOT NULL,
	"workspace_root" text NOT NULL,
	"gateway_port" integer,
	"dashboard_port" integer,
	"config" text DEFAULT '{}' NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"owner_gateway" text,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "token_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"session_id" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"workspace_id" integer DEFAULT 1 NOT NULL,
	"task_id" integer,
	"cost_usd" real,
	"agent_name" text,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" integer NOT NULL,
	"created_at" integer,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"created_at" integer,
	"updated_at" integer,
	"last_login_at" integer,
	"provider" text DEFAULT 'local' NOT NULL,
	"provider_user_id" text,
	"email" text,
	"avatar_url" text,
	"is_approved" boolean DEFAULT true,
	"approved_by" text,
	"approved_at" integer,
	"workspace_id" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"is_retry" boolean DEFAULT false,
	"created_at" integer
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" text DEFAULT '["*"]' NOT NULL,
	"enabled" boolean DEFAULT true,
	"last_fired_at" integer,
	"last_status" integer,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "workflow_pipelines" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" text DEFAULT '[]' NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" integer,
	"updated_at" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" integer
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"model" text DEFAULT 'sonnet' NOT NULL,
	"task_prompt" text NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"agent_role" text,
	"tags" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" integer,
	"updated_at" integer,
	"last_used_at" integer,
	"use_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_depends_on_issues_id_fk" FOREIGN KEY ("depends_on") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_resources" ADD CONSTRAINT "issue_resources_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_task_id_issues_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_interactions" ADD CONSTRAINT "tweet_interactions_tweet_id_tweets_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."tweets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_ratings" ADD CONSTRAINT "tweet_ratings_tweet_id_tweets_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."tweets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_approved_user_id_users_id_fk" FOREIGN KEY ("approved_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_configs" ADD CONSTRAINT "adapter_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_connections" ADD CONSTRAINT "direct_connections_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_workflow_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."workflow_pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provision_events" ADD CONSTRAINT "provision_events_job_id_provision_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."provision_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provision_jobs" ADD CONSTRAINT "provision_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subscriptions" ADD CONSTRAINT "task_subscriptions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;