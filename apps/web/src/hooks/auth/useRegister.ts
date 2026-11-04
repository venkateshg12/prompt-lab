import { register } from "@/api/auth";
import type { FailureResponse, RegisterResponse, SuccessResponse } from "@/types";
import type { RegisterSchema } from "@repo/types";
import { useMutation } from "@tanstack/react-query";

export const useRegister = () => {
    return useMutation<
        SuccessResponse<RegisterResponse>,
        FailureResponse,
        RegisterSchema
    >({
        mutationFn: register,
    });
};
