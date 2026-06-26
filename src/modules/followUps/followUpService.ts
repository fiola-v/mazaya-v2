import { supabase } from '../../db/supabase';
import { CompanyPipelineStatus, FollowUpNextStep, FollowUpResult, FollowUpRow } from '../../types/mazaya';

export interface FollowUpCreateInput {
  company_id: string;
  contact_id?: string | null;
  reminder_id?: string | null;
  follow_up_date?: string;
  follow_up_result?: FollowUpResult | null;
  next_step?: FollowUpNextStep | null;
  next_action_date?: string | null;
  current_pipeline_status?: CompanyPipelineStatus | string | null;
  follow_up_note?: string | null;
  created_by?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function createFollowUp(input: FollowUpCreateInput): Promise<FollowUpRow> {
  const payload = {
    follow_up_status: 'Completed',
    ...input,
  };

  const { data, error } = await supabase.from('follow_ups').insert(payload).select('*').single();

  if (error) {
    throwSupabaseError('createFollowUp', error);
  }

  return data as FollowUpRow;
}
