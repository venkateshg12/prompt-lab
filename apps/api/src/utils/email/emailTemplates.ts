import { CLIENT_URL } from "../../constants/env";
import { emailVerificationTemplate, passwordResetTemplate } from "./html_templates";

export const getVerificationEmail = (token: string) => {
    const emailVerificationLink = `${CLIENT_URL}/auth/verify/${token}`;

    return {
        subject: "Verify your email — Prompt Lab",
        text: `Please verify your email by clicking the following link: ${emailVerificationLink}`,
        html: emailVerificationTemplate(emailVerificationLink)
    };
};

export const getPasswordResetEmail = (token: string) => {
    const resetLink = `${CLIENT_URL}/password/reset/${token}`;
    return {
        subject: "Reset your password — Prompt Lab",
        text: `Please reset your password by clicking the following link: ${resetLink}`,
        html: passwordResetTemplate(resetLink)
    };
};

// Phase 10: getOrgInviteEmail · Phase 17: getRunFinishedEmail
