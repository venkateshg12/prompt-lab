import type { User } from "../generated/prisma/client";

export type UserRecord = User;

/** A user as it may leave the API: never the password hash. */
export type SafeUser = Omit<User, "password">;

export const toSafeUser = (user: User): SafeUser => {
    const { password: _password, ...safe } = user;
    return safe;
};
