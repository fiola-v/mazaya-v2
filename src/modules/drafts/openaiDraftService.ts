import OpenAI from 'openai';
import { env } from '../../config/env';

export type DraftChannel = 'WhatsApp follow-up' | 'Email follow-up' | 'LinkedIn follow-up';

export interface DraftContextInput {
  companyName: string;
  reportCardId: string;
  industry: string;
  contactName: string | null;
  role: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  latestVisitStatus: string | null;
  lastVisitedDate: string | null;
  interestLevel: string | null;
  blocker: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  openReminders: Array<{ action: string; dueDate: string; dueTime: string | null; status: string }>;
  latestFollowUps: Array<{ date: string; result: string | null; nextStep: string | null; note: string | null }>;
  latestVisitNote: string | null;
}

export interface DraftGenerationInput {
  draftType: DraftChannel;
  draftGoal: string;
  extraContext: string | null;
  addInstruction: string | null;
  crm: DraftContextInput;
}

export interface DraftGenerationResult {
  deal_reality: string;
  current_stage: string;
  likely_blocker: string;
  recommended_next_action: string;
  draft_type: string;
  draft_goal: string;
  subject_line: string | null;
  draft_text: string;
  suggested_reminder_text: string | null;
  suggested_reminder_date_hint: string | null;
  crm_status_suggestion: string;
  crm_note: string;
}

function readOutputText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const textParts: string[] = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const segment of content) {
      const text = typeof segment?.text === 'string' ? segment.text : null;
      if (text && text.trim().length > 0) {
        textParts.push(text.trim());
      }
    }
  }

  return textParts.join('\n').trim();
}

function coerceString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeResult(payload: any): DraftGenerationResult {
  return {
    deal_reality: coerceString(payload?.deal_reality),
    current_stage: coerceString(payload?.current_stage),
    likely_blocker: coerceString(payload?.likely_blocker),
    recommended_next_action: coerceString(payload?.recommended_next_action),
    draft_type: coerceString(payload?.draft_type),
    draft_goal: coerceString(payload?.draft_goal),
    subject_line: coerceNullableString(payload?.subject_line),
    draft_text: coerceString(payload?.draft_text),
    suggested_reminder_text: coerceNullableString(payload?.suggested_reminder_text),
    suggested_reminder_date_hint: coerceNullableString(payload?.suggested_reminder_date_hint),
    crm_status_suggestion: coerceString(payload?.crm_status_suggestion),
    crm_note: coerceString(payload?.crm_note),
  };
}

export async function generateSalesDraft(input: DraftGenerationInput): Promise<DraftGenerationResult> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY_MISSING');
  }

  if (!env.OPENAI_DRAFT_MODEL) {
    throw new Error('OPENAI_DRAFT_MODEL_MISSING');
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const model = env.OPENAI_DRAFT_MODEL;

  const systemPrompt = [
    'You are a sales drafting assistant for Mazaya.',
    'Use only the CRM context and user instruction provided.',
    'Do not invent stakeholder titles such as GM, CFO, owner, finance, legal, or compliance.',
    'Only mention a specific stakeholder if that stakeholder is present in CRM context or user extra context.',
    'If no stakeholder is specified, use "the right decision-maker" or "the person responsible for payments/finance".',
    'Do not invent facts, clients, performance claims, compliance claims, pricing, or settlement promises.',
    'Do not use phrases like fully compliant, guaranteed, zero risk, or instant settlement.',
    'Every draft must move the deal toward a concrete commercial outcome.',
    'Diagnose likely blocker and propose a specific next step with owner/date/time where possible.',
    'Warm, professional, human tone. No aggressive pressure.',
    'WhatsApp draft must be concise. Email may include a subject. LinkedIn should be short.',
    'Return draft_text with short paragraphs and clear mobile readability.',
    'Use line breaks between paragraphs and keep the draft concise.',
    'For real estate, focus on deposits, reservation payments, international buyers, and easier payment flow.',
  ].join(' ');

  const userPayload = {
    draft_type: input.draftType,
    draft_goal: input.draftGoal,
    extra_context: input.extraContext ?? 'No additional user context was provided. Use only CRM context.',
    add_instruction: input.addInstruction,
    crm: input.crm,
  };

  let response: any;
  try {
    response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate one practical sales draft from this JSON context:\n${JSON.stringify(userPayload)}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'mazaya_draft_result',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'deal_reality',
              'current_stage',
              'likely_blocker',
              'recommended_next_action',
              'draft_type',
              'draft_goal',
              'subject_line',
              'draft_text',
              'suggested_reminder_text',
              'suggested_reminder_date_hint',
              'crm_status_suggestion',
              'crm_note',
            ],
            properties: {
              deal_reality: { type: 'string' },
              current_stage: { type: 'string' },
              likely_blocker: { type: 'string' },
              recommended_next_action: { type: 'string' },
              draft_type: { type: 'string' },
              draft_goal: { type: 'string' },
              subject_line: { type: ['string', 'null'] },
              draft_text: { type: 'string' },
              suggested_reminder_text: { type: ['string', 'null'] },
              suggested_reminder_date_hint: { type: ['string', 'null'] },
              crm_status_suggestion: { type: 'string' },
              crm_note: { type: 'string' },
            },
          },
        },
      },
    } as any);
  } catch (error) {
    const code = (error as any)?.code ?? (error as any)?.error?.code;
    const message = String((error as any)?.message ?? '');
    if (code === 'model_not_found' || message.includes('model_not_found')) {
      throw new Error('OPENAI_MODEL_NOT_AVAILABLE');
    }

    throw new Error('DRAFT_API_FAILED');
  }

  const outputText = readOutputText(response);
  if (!outputText) {
    throw new Error('DRAFT_OUTPUT_EMPTY');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error('DRAFT_OUTPUT_INVALID_JSON');
  }

  const result = normalizeResult(parsed);
  if (!result.draft_text) {
    throw new Error('DRAFT_TEXT_MISSING');
  }

  return result;
}
