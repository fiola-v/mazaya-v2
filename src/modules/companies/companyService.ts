import { supabase } from '../../db/supabase';
import { CompanyPipelineStatus, CompanyRow, InterestLevel, VisitStatus } from '../../types/mazaya';

export interface CompanyCreateInput {
  company_code?: string;
  company_name: string;
  industry?: string;
  visit_status?: VisitStatus;
  interest_level?: InterestLevel;
  client_pipeline_status?: CompanyPipelineStatus;
  current_blocker?: string;
  latest_human_note?: string;
  current_next_action?: string;
  next_action_date?: string;
  main_contact_id?: string;
  website?: string;
  address?: string;
}

export interface CompanyCurrentStateUpdateInput {
  company_code?: string | null;
  company_name?: string;
  industry?: string | null;
  visit_status?: VisitStatus | null;
  interest_level?: InterestLevel | null;
  client_pipeline_status?: CompanyPipelineStatus | null;
  current_blocker?: string | null;
  latest_human_note?: string | null;
  current_next_action?: string | null;
  next_action_date?: string | null;
  main_contact_id?: string | null;
  website?: string | null;
  address?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function createCompany(input: CompanyCreateInput): Promise<CompanyRow> {
  const payload = {
    client_pipeline_status: 'Potential Client' as CompanyPipelineStatus,
    ...input,
  };

  const { data, error } = await supabase.from('companies').insert(payload).select('*').single();

  if (error) {
    throwSupabaseError('createCompany', error);
  }

  return data as CompanyRow;
}

export async function updateCompanyCurrentState(companyId: string, input: CompanyCurrentStateUpdateInput): Promise<CompanyRow> {
  const { data, error } = await supabase
    .from('companies')
    .update(input)
    .eq('id', companyId)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('updateCompanyCurrentState', error);
  }

  return data as CompanyRow;
}

export async function findCompaniesByName(companyName: string): Promise<CompanyRow[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .ilike('company_name', `%${companyName}%`)
    .order('company_name', { ascending: true });

  if (error) {
    throwSupabaseError('findCompaniesByName', error);
  }

  return (data ?? []) as CompanyRow[];
}

export async function getCompanyById(companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();

  if (error) {
    throwSupabaseError('getCompanyById', error);
  }

  return (data as CompanyRow | null) ?? null;
}
