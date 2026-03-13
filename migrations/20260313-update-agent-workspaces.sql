-- Migration: Update agent workspace paths and clean up agents table
-- Task: 46619ab1-001c-4c50-bc12-861e3fe426b2

-- 1. Delete stale duplicate row (id=13)
DELETE FROM agents WHERE id = 13;

-- 2. Update Cseno (id=1): workspace path + model
UPDATE agents
SET config = json_set(config, '$.workspace', '/Users/cripto/.openclaw/workspaces/main', '$.model', 'anthropic/claude-opus-4-6')
WHERE id = 1;

-- 3. Update Piem (id=6): workspace path, openclawId, identity.name
UPDATE agents
SET config = json_set(config,
  '$.workspace', '/Users/cripto/.openclaw/workspaces/piem',
  '$.openclawId', 'piem',
  '$.identity.name', 'Piem'
)
WHERE id = 6;

-- 4. Update Worm (id=3): identity.name
UPDATE agents
SET config = json_set(config, '$.identity.name', 'Worm')
WHERE id = 3;
