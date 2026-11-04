import type { User } from "./user.types";

export * from "./api.types";
export * from "./auth.types";
export * from "./user.types";
export * from "./ui.types";

export type UpdateProfilePayload = { name: string };
export type UpdateProfileResponse = { user: User };
export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
};
export type ChangePasswordResponse = { message: string };
