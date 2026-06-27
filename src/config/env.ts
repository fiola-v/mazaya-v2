import 'dotenv/config';
import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  SUPABASE_URL: z.string().trim().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  OPENAI_API_KEY: optionalString,
  OPENAI_DRAFT_MODEL: optionalString,
  GOOGLE_SHEET_ID: optionalString,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_PRIVATE_KEY: optionalString,
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const messages = parsedEnv.error.issues.map((issue) => issue.message).join('; ');
  throw new Error(`Invalid environment configuration: ${messages}`);
}

export const env = parsedEnv.data;
