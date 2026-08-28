---
name: clickup
description: >
  Manage ClickUp tasks, lists, folders, and spaces via the ClickUp REST API v2.
  Use when you need to create, update, delete, or query tasks; manage lists and folders;
  or organize workspace issues, bugs, features, and roadmaps with priorities, tags, and full descriptions.
---

# ClickUp API Skill

Use this skill to interact directly with ClickUp Workspace using the ClickUp REST API v2.

---

## 1. Authentication

ClickUp API requires an Authorization header with a Personal API Token:
`Authorization: <CLICKUP_API_TOKEN>` (or `pk_...` token).

Environment Variable: `CLICKUP_API_TOKEN`

---

## 2. Priority Mapping in ClickUp

| Priority Label | ClickUp API Value (`priority`) | Color / Urgency |
|---|---|---|
| **Urgent** | `1` | 🔴 Red |
| **High** | `2` | 🟡 Yellow |
| **Normal** | `3` | 🔵 Blue |
| **Low** | `4` | ⚪ Grey |

---

## 3. Core API Operations

### A. List Teams / Workspaces
```bash
curl -s -X GET "https://api.clickup.com/api/v2/team" \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json"
```

### B. List Spaces in a Team
```bash
curl -s -X GET "https://api.clickup.com/api/v2/team/{team_id}/space?archived=false" \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json"
```

### C. List Folders & Lists in a Space
```bash
# Folders
curl -s -X GET "https://api.clickup.com/api/v2/space/{space_id}/folder?archived=false" \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json"

# Folderless Lists
curl -s -X GET "https://api.clickup.com/api/v2/space/{space_id}/list?archived=false" \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json"
```

### D. Create a Task
```bash
curl -s -X POST "https://api.clickup.com/api/v2/list/{list_id}/task" \
  -H "Authorization: $CLICKUP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Task Name",
    "markdown_description": "Detailed description of the issue/feature...",
    "priority": 2,
    "tags": ["backend", "security", "multi-tenant"],
    "status": "to do"
  }'
```

---

## 4. Node.js Helper Script

Use the Node.js script to batch create or sync tasks:

```javascript
const https = require('https');

async function createClickUpTask({ token, listId, name, description, priority, tags }) {
  const payload = JSON.stringify({
    name,
    markdown_description: description,
    priority: priority || 3,
    tags: tags || [],
    status: 'to do'
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://api.clickup.com/api/v2/list/${listId}/task`,
      {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
```