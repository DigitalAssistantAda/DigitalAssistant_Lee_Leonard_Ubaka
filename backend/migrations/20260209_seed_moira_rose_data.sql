-- Seed data for Moira Rose (UI/UX Designer II) and Rylee Lavender (Instructional Designer)
-- Intended for development/test environments only.

UPDATE users
SET email = 'moira.rose@figma'
WHERE username = 'moira.rose'
    AND email <> 'moira.rose@figma';

UPDATE users
SET email = 'rylee.lavender@example.com'
WHERE username = 'rylee.lavender'
    AND email <> 'rylee.lavender@example.com';

UPDATE users
SET hashed_password = '$2b$12$lfp/DZQFDBb/92KsDRsKj./sIF4Ln1toxQ2UFFLyhVupQx5fX8uuq'
WHERE username = 'rylee.lavender'
    AND (hashed_password IS NULL OR hashed_password = '');

INSERT INTO users (email, username, hashed_password, is_active, is_deleted)
SELECT 'moira.rose@figma', 'moira.rose', NULL, true, false
WHERE NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.email = 'moira.rose@figma'
             OR u.username = 'moira.rose'
);

INSERT INTO users (email, username, hashed_password, is_active, is_deleted)
SELECT 'rylee.lavender@example.com', 'rylee.lavender', '$2b$12$lfp/DZQFDBb/92KsDRsKj./sIF4Ln1toxQ2UFFLyhVupQx5fX8uuq', true, false
WHERE NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.email = 'rylee.lavender@example.com'
             OR u.username = 'rylee.lavender'
);

INSERT INTO user_preferences (user_id, accent_color)
SELECT u.id, '#2E2A25'
FROM users u
WHERE u.email = 'moira.rose@figma'
ON CONFLICT (user_id) DO UPDATE
SET accent_color = EXCLUDED.accent_color,
    updated_at = now();

INSERT INTO user_preferences (user_id, accent_color)
SELECT u.id, '#6E8B6E'
FROM users u
WHERE u.email = 'rylee.lavender@example.com'
ON CONFLICT (user_id) DO UPDATE
SET accent_color = EXCLUDED.accent_color,
    updated_at = now();

INSERT INTO workspaces (name, accent_color, created_by)
SELECT 'Design Ops', '#2E2A25', u.id
FROM users u
WHERE u.email = 'moira.rose@figma'
  AND NOT EXISTS (
      SELECT 1
      FROM workspaces w
      WHERE w.name = 'Design Ops'
  );

INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at, updated_at)
SELECT w.id, u.id, 'owner', 'active', now() - interval '60 days', now() - interval '1 day'
FROM workspaces w
JOIN users u ON u.email = 'moira.rose@figma'
WHERE w.name = 'Design Ops'
  AND NOT EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.workspace_id = w.id
        AND wm.user_id = u.id
  );

INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at, updated_at)
SELECT w.id, u.id, 'member', 'active', now() - interval '45 days', now() - interval '2 days'
FROM workspaces w
JOIN users u ON u.email = 'rylee.lavender@example.com'
WHERE w.name = 'Design Ops'
  AND NOT EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.workspace_id = w.id
        AND wm.user_id = u.id
  );

WITH target_workspace AS (
    SELECT id
    FROM workspaces
    WHERE name = 'Design Ops'
    ORDER BY id
    LIMIT 1
),
conversation_titles AS (
    SELECT 1 AS idx, 'UX Audit - Onboarding' AS title
    UNION ALL SELECT 2, 'Design System v2'
    UNION ALL SELECT 3, 'Usability Testing Sprint'
    UNION ALL SELECT 4, 'Accessibility Fixes'
)
INSERT INTO conversations (workspace_id, created_by, title, last_message_at, created_at)
SELECT tw.id,
       u.id,
       ct.title,
       date_trunc('day', now() - interval '30 days') + (ct.idx || ' days')::interval + interval '16 hours',
       date_trunc('day', now() - interval '30 days') + (ct.idx || ' days')::interval + interval '9 hours'
FROM target_workspace tw
JOIN users u ON u.email = 'moira.rose@figma'
JOIN conversation_titles ct ON true
WHERE NOT EXISTS (
    SELECT 1
    FROM conversations c
    WHERE c.workspace_id = tw.id
      AND c.title = ct.title
);

WITH target_workspace AS (
    SELECT id
    FROM workspaces
    WHERE name = 'Design Ops'
    ORDER BY id
    LIMIT 1
),
moira AS (
    SELECT id FROM users WHERE email = 'moira.rose@figma'
),
rylee AS (
    SELECT id FROM users WHERE email = 'rylee.lavender@example.com'
),
series AS (
    SELECT generate_series(0, 29) AS day_offset
),
slots AS (
    SELECT 1 AS msg_slot
    UNION ALL SELECT 2
)
INSERT INTO messages (workspace_id, sender_id, content, is_edited, created_at, updated_at)
SELECT tw.id,
       CASE WHEN s.msg_slot = 1 THEN moira.id ELSE rylee.id END,
       CASE
         WHEN s.msg_slot = 1 AND (series.day_offset % 5) = 0 THEN 'Moira: Polished the city-centric onboarding flow and tightened the CTA hierarchy.'
         WHEN s.msg_slot = 1 AND (series.day_offset % 5) = 1 THEN 'Moira: UI/UX Designer II review complete; refined the grid and elevated the hero visual.'
         WHEN s.msg_slot = 1 AND (series.day_offset % 5) = 2 THEN 'Moira: Added interaction notes for the modal flow and tuned the layout spacing.'
         WHEN s.msg_slot = 1 AND (series.day_offset % 5) = 3 THEN 'Moira: Finalized mobile breakpoints and aligned iconography for the metro nav.'
         WHEN s.msg_slot = 1 THEN 'Moira: Consolidated usability feedback and queued the next round of urban-inspired updates.'
         WHEN s.msg_slot = 2 AND (series.day_offset % 5) = 0 THEN 'Rylee: Drafted microcopy for gentle error states and shared an eco-friendly tone guide.'
         WHEN s.msg_slot = 2 AND (series.day_offset % 5) = 1 THEN 'Rylee: Built a learning flow outline with calm, earthy language.'
         WHEN s.msg_slot = 2 AND (series.day_offset % 5) = 2 THEN 'Rylee: Added guidance text for empty states and suggested sustainable phrasing.'
         WHEN s.msg_slot = 2 AND (series.day_offset % 5) = 3 THEN 'Rylee: Updated the tooltip script and linked examples to the reusable patterns.'
         ELSE 'Rylee: Shared test notes and flagged a few usability risks to review.'
       END,
       false,
       date_trunc('day', now() - interval '30 days')
         + (series.day_offset || ' days')::interval
         + CASE WHEN s.msg_slot = 1 THEN interval '10 hours' ELSE interval '16 hours' END,
       date_trunc('day', now() - interval '30 days')
         + (series.day_offset || ' days')::interval
         + CASE WHEN s.msg_slot = 1 THEN interval '10 hours' ELSE interval '16 hours' END
FROM target_workspace tw
CROSS JOIN moira
CROSS JOIN rylee
CROSS JOIN series
CROSS JOIN slots s;

WITH target_workspace AS (
    SELECT id
    FROM workspaces
    WHERE name = 'Design Ops'
    ORDER BY id
    LIMIT 1
),
moira AS (
    SELECT id FROM users WHERE email = 'moira.rose@figma'
),
rylee AS (
    SELECT id FROM users WHERE email = 'rylee.lavender@example.com'
),
series AS (
    SELECT generate_series(0, 19) AS n
)
INSERT INTO tasks (
    workspace_id,
    title,
    description,
    type,
    status,
    priority,
    assigned_to,
    due_date,
    created_by,
    created_at,
    updated_at
)
SELECT tw.id,
       CASE
           WHEN (series.n % 4) = 0 THEN 'Review design system tokens'
           WHEN (series.n % 4) = 1 THEN 'Prototype city onboarding flow'
           WHEN (series.n % 4) = 2 THEN 'Accessibility audit for dashboard'
           ELSE 'Revise earthy empty state copy'
       END,
       CASE
           WHEN (series.n % 4) = 0 THEN 'Moira (UI/UX Designer II) to audit token usage and refine the upscale palette.'
           WHEN (series.n % 4) = 1 THEN 'Create clickable prototype and document city-focused interaction cues for engineers.'
           WHEN (series.n % 4) = 2 THEN 'Check contrast, focus order, and keyboard navigation for core widgets.'
           ELSE 'Align instructional copy with the new layout and review with Rylee.'
       END,
       (CASE WHEN (series.n % 3) = 0 THEN 'deadline' ELSE 'issue' END)::tasktype,
       CASE
           WHEN (series.n % 5) = 0 THEN 'completed'
           WHEN (series.n % 5) = 1 THEN 'in_progress'
           WHEN (series.n % 5) = 2 THEN 'open'
           WHEN (series.n % 5) = 3 THEN 'overdue'
           ELSE 'closed'
       END::taskstatus,
       CASE
           WHEN (series.n % 3) = 0 THEN 'high'
           WHEN (series.n % 3) = 1 THEN 'medium'
           ELSE 'low'
       END::taskpriority,
       CASE WHEN (series.n % 2) = 0 THEN moira.id ELSE rylee.id END,
       date_trunc('day', now() - interval '30 days') + (series.n || ' days')::interval + interval '17 hours',
       moira.id,
       date_trunc('day', now() - interval '30 days') + (series.n || ' days')::interval + interval '9 hours',
       date_trunc('day', now() - interval '30 days') + (series.n || ' days')::interval + interval '12 hours'
FROM target_workspace tw
CROSS JOIN moira
CROSS JOIN rylee
CROSS JOIN series;

WITH target_workspace AS (
    SELECT id
    FROM workspaces
    WHERE name = 'Design Ops'
    ORDER BY id
    LIMIT 1
),
moira AS (
    SELECT id FROM users WHERE email = 'moira.rose@figma'
),
rylee AS (
    SELECT id FROM users WHERE email = 'rylee.lavender@example.com'
),
series AS (
    SELECT generate_series(0, 119) AS n
)
INSERT INTO audit_logs (
    workspace_id,
    actor_user_id,
    action,
    object_type,
    object_id,
    metadata_json,
    created_at
)
SELECT tw.id,
       CASE WHEN (series.n % 3) = 0 THEN moira.id ELSE rylee.id END,
       CASE
           WHEN (series.n % 5) = 0 THEN 'task.created'
           WHEN (series.n % 5) = 1 THEN 'task.updated'
           WHEN (series.n % 5) = 2 THEN 'message.sent'
           WHEN (series.n % 5) = 3 THEN 'conversation.updated'
           ELSE 'workspace.member_added'
       END,
       CASE
           WHEN (series.n % 5) IN (0, 1) THEN 'task'
           WHEN (series.n % 5) = 2 THEN 'message'
           WHEN (series.n % 5) = 3 THEN 'conversation'
           ELSE 'workspace_member'
       END,
       NULL,
       json_build_object(
           'source', 'seed',
           'note', CASE
               WHEN (series.n % 5) = 0 THEN 'Task created for UI/UX delivery milestone.'
               WHEN (series.n % 5) = 1 THEN 'Task updated after design review.'
               WHEN (series.n % 5) = 2 THEN 'Workspace message logged for design collaboration.'
               WHEN (series.n % 5) = 3 THEN 'Conversation updated with UX testing notes.'
               ELSE 'Added workspace member for instructional design support.'
           END
       ),
       date_trunc('day', now() - interval '30 days') + (series.n || ' hours')::interval
FROM target_workspace tw
CROSS JOIN moira
CROSS JOIN rylee
CROSS JOIN series;
