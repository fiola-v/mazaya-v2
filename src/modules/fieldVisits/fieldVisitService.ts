import { supabase } from '../../db/supabase';
import { DecisionMakerStatus, FieldVisitRow, InterestLevel, NextStep, VisitStatus } from '../../types/mazaya';

export interface FieldVisitCreateInput {
  company_id: string;
  contact_id?: string | null;
  visit_date?: string;
  decision_maker_status?: DecisionMakerStatus | null;
  visit_status?: VisitStatus | null;
  interest_level?: InterestLevel | null;
  blocker?: string | null;
  info_sent?: boolean | null;
  next_step?: NextStep | null;
  next_action_date?: string | null;
  visit_note?: string | null;
  created_by?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function createFieldVisit(input: FieldVisitCreateInput): Promise<FieldVisitRow> {
  const { data, error } = await supabase.from('field_visits').insert(input).select('*').single();

  if (error) {
    throwSupabaseError('createFieldVisit', error);
  }

  return data as FieldVisitRow;
}

export async function listFieldVisitsByCompany(companyId: string): Promise<FieldVisitRow[]> {
  const { data, error } = await supabase
    .from('field_visits')
    .select('*')
    .eq('company_id', companyId)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listFieldVisitsByCompany', error);
  }

  return (data ?? []) as FieldVisitRow[];
}
