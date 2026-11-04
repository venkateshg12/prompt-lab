import type { User } from "../generated/prisma/client";

export type RefreshTokenPayload = {
  sessionId: string;
  // Identifies this particular refresh token, so a replayed older one can be told apart.
  jti: string;
};

export type AccessTokenPayload = {
  userId: string;
  role: User["role"];
  sessionId: string;
};
