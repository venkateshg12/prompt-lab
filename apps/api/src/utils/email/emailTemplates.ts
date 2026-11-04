import { CLIENT_URL } from "../../constants/env";
import { emailVerificationTemplate, orgInviteTemplate, passwordResetTemplate } from "./html_templates";

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

export const getOrgInviteEmail = (token: string, orgName: string, role: string) => {
    // The token is in the URL fragment: a fragment is never sent to any server, so it can't reach a log.
    const inviteLink = `${CLIENT_URL}/invites#token=${token}`;
    return {
        subject: `You're invited to ${orgName} on Prompt Lab`,
        text: `You have been invited to join ${orgName} on Prompt Lab as a ${role}. Accept the invite here: ${inviteLink}`,
        html: orgInviteTemplate(inviteLink, orgName, role),
    };
};

// Phase 17: getRunFinishedEmail
