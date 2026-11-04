import { Router } from "express"
import authenticate from "../middleware/authenticate";
import { deleteSessionHandler, getSessionHandler } from "../controllers/session.controller";

const sessionRoutes = Router();

sessionRoutes.use(authenticate); // Phase 06: protectedApiLimiter

sessionRoutes.get("/", getSessionHandler);
sessionRoutes.delete("/:id", deleteSessionHandler);

export default sessionRoutes;
