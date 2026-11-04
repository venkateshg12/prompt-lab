import type { OrgRole, OrgPermission } from "@repo/types";

// ADAPT: PaperTrail's shape and can(), Prompt Lab's vocabulary (architecture.md §3).
const READ = ["tasks.read", "runs.read"] as const;

export const PERMISSIONS = {
    owner: ["*"],
    admin: [
        ...READ,
        "examples.second_label",
        "examples.manage",
        "tasks.manage",
        "prompts.manage",
        "runs.start",
        "runs.publish",
        "members.manage",
        "org.update",
    ],
    reviewer: [...READ, "examples.second_label"],
    viewer: [...READ],
} as const satisfies Record<OrgRole, readonly string[]>;

export type Permission = OrgPermission;

export const can = (role: OrgRole | undefined, permission: Permission): boolean => {
    if (!role) return false;
    const allowed = PERMISSIONS[role] as readonly string[];
    return allowed.includes("*") || allowed.includes(permission);
};
