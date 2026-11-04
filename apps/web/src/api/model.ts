import API from "@/lib/api";
import type { SuccessResponse } from "@/types";
import type { ModelDto } from "@repo/types";

export const listModels = async () => (await API.get<SuccessResponse<ModelDto[]>>("/models")).data;
