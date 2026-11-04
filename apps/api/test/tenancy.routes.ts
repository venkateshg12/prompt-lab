/*
  The id routes Phase 28's cross-tenant suite walks: each is called as a member of workspace B against
  workspace A's id and must answer 404. Later phases append their id routes here.
 */
export const TENANT_ROUTES = [
    { method: "get", path: "/orgs/:orgId" },
    { method: "patch", path: "/orgs/:orgId", body: { name: "x" } },
    { method: "get", path: "/orgs/:orgId/members" },
    { method: "get", path: "/orgs/:orgId/invites" },
    { method: "post", path: "/orgs/:orgId/invites", body: { email: "x@example.com", role: "viewer" } },
    { method: "get", path: "/orgs/:orgId/tasks" },
    { method: "get", path: "/orgs/:orgId/tasks/:taskId" },
    { method: "patch", path: "/orgs/:orgId/tasks/:taskId", body: { name: "x" } },
    { method: "delete", path: "/orgs/:orgId/tasks/:taskId" },
    { method: "get", path: "/orgs/:orgId/tasks/:taskId/examples" },
    { method: "get", path: "/orgs/:orgId/tasks/:taskId/examples/agreement" },
    { method: "get", path: "/orgs/:orgId/tasks/:taskId/examples/export.jsonl" },
    { method: "post", path: "/orgs/:orgId/tasks/:taskId/examples/import", body: { format: "jsonl", content: "{}", dryRun: true } },
    { method: "post", path: "/orgs/:orgId/tasks/:taskId/examples/split", body: {} },
    { method: "patch", path: "/orgs/:orgId/tasks/:taskId/examples/:exampleId", body: { tags: [] } },
    { method: "put", path: "/orgs/:orgId/tasks/:taskId/examples/:exampleId/second-label", body: { label: {} } },
    { method: "delete", path: "/orgs/:orgId/tasks/:taskId/examples/:exampleId" },
] as const;
