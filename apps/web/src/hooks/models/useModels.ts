import { useQuery } from "@tanstack/react-query";
import { listModels } from "@/api/model";

// The model registry is the same for everyone (not in USER_SCOPED_KEYS on purpose).
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: listModels, staleTime: 5 * 60_000 });
