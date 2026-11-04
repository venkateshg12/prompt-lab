import type { Request, Response } from "express";

export interface SseStream {
    send: (event: string, data: unknown) => void;
}

/**
 * Initializes an SSE response stream with headers, 20s heartbeats, and client disconnect handling.
 */
export const openStream = (
    req: Request,
    res: Response,
    onClose: () => void
): SseStream => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    // Tell the browser EventSource to wait 5 seconds before reconnecting
    res.write("retry: 5000\n\n");

    let id = 0;
    const heartbeat = setInterval(() => {
        try {
            res.write(": ping\n\n");
        } catch {
            // Socket severed
        }
    }, 20_000);

    let closed = false;
    const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        onClose();
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    return {
        send: (event: string, data: unknown) => {
            if (closed) return;
            try {
                res.write(`id: ${++id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            } catch {
                cleanup();
            }
        },
    };
};
