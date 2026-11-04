export type UserRole = "user" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  verified: boolean;
  avatar?: string;
  authProvider: "local" | "google";
  createdAt: string;
  updatedAt: string;
}

// The slice of the user the app keeps in the auth store.
export interface AppUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: UserRole;
}
