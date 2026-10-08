CREATE TABLE webhook_endpoints_next (
 id text PRIMARY KEY NOT NULL, owner_id text NOT NULL, loop_id text NOT NULL, version_id text NOT NULL,
 trigger_node_id text NOT NULL, token text NOT NULL, secret_ref text NOT NULL, signature_header text NOT NULL,
 signature_scheme text NOT NULL, replay_window_seconds integer,
 enabled integer NOT NULL, created_at text NOT NULL,
 CONSTRAINT webhook_endpoint_signing_check CHECK ((signature_scheme = 'hmac-sha256' AND replay_window_seconds > 0 AND replay_window_seconds IS NOT NULL)
 OR (signature_scheme = 'hmac-sha256-body' AND replay_window_seconds IS NULL))
);
--> statement-breakpoint
INSERT INTO webhook_endpoints_next (id,owner_id,loop_id,version_id,trigger_node_id,token,secret_ref,signature_header,signature_scheme,replay_window_seconds,enabled,created_at)
 SELECT id,owner_id,loop_id,version_id,trigger_node_id,token,secret_ref,signature_header,'hmac-sha256',replay_window_seconds,enabled,created_at FROM webhook_endpoints;
--> statement-breakpoint
DROP TABLE webhook_endpoints;
--> statement-breakpoint
ALTER TABLE webhook_endpoints_next RENAME TO webhook_endpoints;
--> statement-breakpoint
CREATE INDEX webhook_endpoints_token_idx ON webhook_endpoints (token);
--> statement-breakpoint
CREATE INDEX webhook_endpoints_loop_idx ON webhook_endpoints (loop_id,version_id);
--> statement-breakpoint
CREATE TABLE webhook_receipts (
 id text PRIMARY KEY NOT NULL, owner_id text NOT NULL, loop_id text NOT NULL, trigger_node_id text NOT NULL,
 content_hash text NOT NULL, inbound_id text NOT NULL, status text NOT NULL,
 intent text, attempts integer NOT NULL DEFAULT 0, next_attempt_at text, failure_code text,
 CONSTRAINT webhook_receipt_status_check CHECK(status IN ('filtered','deduplicated','pending','admitted','failed')),
 CONSTRAINT webhook_receipt_intent_check CHECK((status IN ('filtered','deduplicated') AND intent IS NULL) OR (status NOT IN ('filtered','deduplicated') AND intent IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX webhook_receipts_content_idx ON webhook_receipts(owner_id,loop_id,trigger_node_id,content_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX webhook_receipts_inbound_idx ON webhook_receipts(inbound_id);
--> statement-breakpoint
CREATE INDEX webhook_receipts_due_idx ON webhook_receipts(status,next_attempt_at);
--> statement-breakpoint
CREATE INDEX runs_trigger_dedupe_idx ON runs(loop_id,json_extract(initial_thread,'$.invocation.trigger.nodeId'),json_extract(initial_thread,'$.invocation.trigger.dedupeKey'));
