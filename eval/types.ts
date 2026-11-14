import { z } from "zod";
export const answersSchema = z.array(z.object({ id: z.string(), answer: z.union([z.number(), z.string(), z.null()]) }));
export type Answers = z.infer<typeof answersSchema>;
