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

export const getRunFinishedEmail = (taskName: string, status: string, totalCells: number, errorCells: number, runUrl: string) => ({
    subject: `Your run on ${taskName} ${status === "completed" ? "finished" : status} — Prompt Lab`,
    text: `Your run on "${taskName}" ${status}: ${totalCells} cells, ${errorCells} error cell${errorCells === 1 ? "" : "s"}. Open the results: ${runUrl}`,
    html: `<p>Your run on <strong>${taskName.replace(/</g, "&lt;")}</strong> ${status}.</p><p>${totalCells} cells, ${errorCells} error cell${errorCells === 1 ? "" : "s"}.</p><p><a href="${runUrl}">Open the results</a></p>`,
});
