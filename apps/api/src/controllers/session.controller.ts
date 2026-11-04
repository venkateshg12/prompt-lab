import z from "zod";
import { NOT_FOUND, OK } from "../constants/https";
import { prisma } from "../db/prisma";
import { catchError, appAssert } from "../utils/errors";
import { ok } from "../utils/api";
import { revokeSessions } from "../services/auth.service";

// A malformed id must be a 400 here, not a database error on the uuid column.
const sessionIdSchema = z.uuid({ message: "Invalid session id" });

export const getSessionHandler = catchError(
    async (req, res) => {
        const sessions = await prisma.session.findMany({
            where: { userId: req.userId, expiresAt: { gt: new Date() } },
            select: { id: true, userAgent: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
        return res.status(OK).json(
            ok(sessions.map((session) => ({
                ...session,
                isCurrent: session.id === req.sessionId,
            })))
        );
    }
)

export const deleteSessionHandler = catchError(
    async (req, res) => {
        const sessionId = sessionIdSchema.parse(req.params.id);
        const revoked = await revokeSessions({
            id: sessionId,
            userId: req.userId,
        });
        appAssert(revoked > 0, NOT_FOUND, "Session not found");
        return res.status(OK).json(
            ok({
                message: "Session expired!"
            })
        )
    }
)
