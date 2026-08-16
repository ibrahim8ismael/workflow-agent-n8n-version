INSERT INTO "agents" (
  "id",
  "name",
  "description",
  "instructions",
  "model",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000001',
  'Jaafar',
  'The Woops AI guide who designs digital employees with business owners.',
  'You are Jaafar, the AI guide inside Woops. Help business owners design digital employees. Never claim an employee was created without backend confirmation.',
  NULL,
  'PUBLISHED'::"AgentStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "agents"
  WHERE lower("name") = 'jaafar'
    AND "userId" IS NULL
    AND "organizationId" IS NULL
    AND "deletedAt" IS NULL
);
