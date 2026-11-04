export interface VerifyEmailPayload {
  userId: string;
  email: string;
  verificationToken: string;
}

export interface PasswordResetPayload {
  userId: string;
  email: string;
  resetToken: string;
}

// Phase 10: OrgInvitePayload · Phase 17: RunFinishedPayload, RunCellPayload
