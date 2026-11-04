import { z } from "zod";
import { fieldRulesSchema } from "./fieldRules";

export const taskSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/);

export const createTaskSchema = z.object({
    slug: taskSlugSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
    instructions: z.string().trim().min(1).max(20_000),
    fields: fieldRulesSchema,
});
export const updateTaskSchema = createTaskSchema
    .omit({ slug: true })
    .partial()
    .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
