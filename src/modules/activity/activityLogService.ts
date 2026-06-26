import { supabase } from '../../db/supabase';
import { ActivityLogRow } from '../../types/mazaya';

export interface ActivityLogInput {
  company_id?: string | null;
  contact_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  activity_type: string;
  summary: string;
  details?: unknown | null;
  source?: string;
  source_room?: string | null;
  created_by?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function logActivity(input: ActivityLogInput): Promise<ActivityLogRow> {
  const payload = {
    source: 'telegram',
    ...input,
  };

  const { data, error } = await supabase.from('activity_logs').insert(payload).select('*').single();

  if (error) {
    throwSupabaseError('logActivity', error);
  }

  return data as ActivityLogRow;
}
