CREATE TABLE webhook_endpoints_next (
 id text PRIMARY KEY NOT NULL, owner_id text NOT NULL, loop_id text NOT NULL, version_id text NOT NULL,
 trigger_node_id text NOT NULL, token text NOT NULL,
 auth_type text NOT NULL, signature_message text, signature_header text, secret_ref text, window_seconds integer,
 enabled integer NOT NULL, created_at text NOT NULL,
 CONSTRAINT webhook_endpoint_signing_check CHECK (("auth_type" = 'none' AND "signature_message" IS NULL AND "signature_header" IS NULL AND "secret_ref" IS NULL AND "window_seconds" IS NULL) OR ("auth_type" = 'hmac-sha256' AND "signature_header" IS NOT NULL AND "secret_ref" IS NOT NULL AND (("signature_message" IS NOT NULL AND "signature_message" = 'body' AND "window_seconds" IS NULL) OR ("signature_message" IS NOT NULL AND "signature_message" = 'timestamp-body' AND "window_seconds" IS NOT NULL AND typeof("window_seconds") = 'integer' AND "window_seconds" BETWEEN 1 AND 86400))))
);
--> statement-breakpoint
INSERT INTO webhook_endpoints_next (id,owner_id,loop_id,version_id,trigger_node_id,token,auth_type,signature_message,signature_header,secret_ref,window_seconds,enabled,created_at)
 SELECT id,owner_id,loop_id,version_id,trigger_node_id,token,'hmac-sha256',CASE signature_scheme WHEN 'hmac-sha256' THEN 'timestamp-body' WHEN 'hmac-sha256-body' THEN 'body' ELSE signature_scheme END,lower(signature_header),secret_ref,replay_window_seconds,enabled,created_at FROM webhook_endpoints;
--> statement-breakpoint
DROP TABLE webhook_endpoints;
--> statement-breakpoint
ALTER TABLE webhook_endpoints_next RENAME TO webhook_endpoints;
--> statement-breakpoint
CREATE INDEX webhook_endpoints_token_idx ON webhook_endpoints (token);
--> statement-breakpoint
CREATE INDEX webhook_endpoints_loop_idx ON webhook_endpoints (loop_id,version_id);
--> statement-breakpoint
DROP INDEX webhook_receipts_content_idx;
--> statement-breakpoint
CREATE INDEX webhook_receipts_content_idx ON webhook_receipts(owner_id,loop_id,trigger_node_id,content_hash);
