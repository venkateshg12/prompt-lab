import type { VerificationLink } from "../generated/prisma/client";
import type { VerificationLinkType } from "../constants/verificationLinkType";

export type VerificationLinkRecord = Omit<VerificationLink, "type"> & { type: VerificationLinkType };
