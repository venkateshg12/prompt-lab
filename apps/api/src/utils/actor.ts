import type { Request } from "express";
import type { AuditActor } from "../services/audit.service";

/** Who is acting on this request, in the audit log's vocabulary. No API keys here: always the user. */
export const actorOf = (req: Request): AuditActor => ({ type: "user", id: req.userId });
