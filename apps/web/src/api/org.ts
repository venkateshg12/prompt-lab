import API from "@/lib/api";
import type { SuccessResponse } from "@/types";
import type { OrgRole, OrgSummary, UpdateOrgSchema, MemberSummary, PendingInvite, InvitePreview, InviteRole } from "@repo/types";

// Every workspace route names its workspace in the path (/orgs/:orgId/...).
export interface OrgResponse {
    org: OrgSummary;
    role: OrgRole;
}

export const listMyOrgs = async (): Promise<SuccessResponse<OrgSummary[]>> => {
    const response = await API.get<SuccessResponse<OrgSummary[]>>("/orgs");
    return response.data;
};

export const getOrg = async (orgId: string): Promise<SuccessResponse<OrgResponse>> => {
    const response = await API.get<SuccessResponse<OrgResponse>>(`/orgs/${orgId}`);
    return response.data;
};

export const updateOrg = async (
    orgId: string,
    data: UpdateOrgSchema
): Promise<SuccessResponse<OrgSummary>> => {
    const response = await API.patch<SuccessResponse<OrgSummary>>(`/orgs/${orgId}`, data);
    return response.data;
};

export const deleteOrg = async (orgId: string, confirmName: string): Promise<SuccessResponse<{ deleted: boolean }>> => {
    const response = await API.delete<SuccessResponse<{ deleted: boolean }>>(`/orgs/${orgId}`, {
        data: { confirmName },
    });
    return response.data;
};

export const listMembers = async (orgId: string): Promise<SuccessResponse<{ members: MemberSummary[] }>> => {
    const response = await API.get<SuccessResponse<{ members: MemberSummary[] }>>(`/orgs/${orgId}/members`);
    return response.data;
};

export const changeMemberRole = async (
    orgId: string,
    userId: string,
    role: OrgRole
): Promise<SuccessResponse<{ userId: string; role: OrgRole }>> => {
    const response = await API.patch<SuccessResponse<{ userId: string; role: OrgRole }>>(
        `/orgs/${orgId}/members/${userId}`,
        { role }
    );
    return response.data;
};

export const removeMember = async (
    orgId: string,
    userId: string
): Promise<SuccessResponse<{ removed: boolean; userId: string }>> => {
    const response = await API.delete<SuccessResponse<{ removed: boolean; userId: string }>>(
        `/orgs/${orgId}/members/${userId}`
    );
    return response.data;
};

export const createInvite = async (
    orgId: string,
    email: string,
    role: InviteRole
): Promise<SuccessResponse<{ invite: PendingInvite }>> => {
    const response = await API.post<SuccessResponse<{ invite: PendingInvite }>>(
        `/orgs/${orgId}/invites`,
        { email, role }
    );
    return response.data;
};

export const listPendingInvites = async (orgId: string): Promise<SuccessResponse<{ invites: PendingInvite[] }>> => {
    const response = await API.get<SuccessResponse<{ invites: PendingInvite[] }>>(`/orgs/${orgId}/invites`);
    return response.data;
};

export const revokeInvite = async (
    orgId: string,
    id: string
): Promise<SuccessResponse<{ revoked: boolean; inviteId: string }>> => {
    const response = await API.delete<SuccessResponse<{ revoked: boolean; inviteId: string }>>(
        `/orgs/${orgId}/invites/${id}`
    );
    return response.data;
};

// The invitation token travels in POST bodies only, never in a path (it would reach access logs).
export const previewInvite = async (token: string): Promise<SuccessResponse<InvitePreview>> => {
    const response = await API.post<SuccessResponse<InvitePreview>>("/invites/preview", { token });
    return response.data;
};

export const acceptInvite = async (token: string): Promise<SuccessResponse<{ orgId: string; role: string }>> => {
    const response = await API.post<SuccessResponse<{ orgId: string; role: string }>>("/invites/accept", { token });
    return response.data;
};
