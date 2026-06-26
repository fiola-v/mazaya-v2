import { supabase } from '../../db/supabase';
import { CompanyPipelineStatus, CompanyRow, InterestLevel, VisitStatus } from '../../types/mazaya';

const REPORT_CARD_SEQUENCE_MIN_DIGITS = 4;
const REPORT_CARD_CODE_RETRY_LIMIT = 10;

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

type SupabaseErrorLike = {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

function throwSupabaseError(operation: string, error: SupabaseErrorLike): never {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

function getReportCardYearSegment(date = new Date()): string {
  return String(date.getFullYear()).slice(-2);
}

function formatReportCardCode(yearSegment: string, sequence: number): string {
  return `RC-${yearSegment}-${String(sequence).padStart(REPORT_CARD_SEQUENCE_MIN_DIGITS, '0')}`;
}

function parseReportCardSequence(companyCode: string | null, yearSegment: string): number | null {
  const match = companyCode?.match(new RegExp(`^RC-${yearSegment}-(\\d+)$`));
  if (!match) {
    return null;
  }

  const sequence = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function isCompanyCodeConflict(error: SupabaseErrorLike): boolean {
  const errorText = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  return error.code === '23505' && errorText.includes('company_code');
}

export async function generateNextReportCardId(date = new Date()): Promise<string> {
  const yearSegment = getReportCardYearSegment(date);
  const { data, error } = await supabase
    .from('companies')
    .select('company_code')
    .like('company_code', `RC-${yearSegment}-%`);

  if (error) {
    throwSupabaseError('generateNextReportCardId', error);
  }

  const maxSequence = (data ?? []).reduce((max, row: { company_code: string | null }) => {
    const sequence = parseReportCardSequence(row.company_code, yearSegment);
    return sequence && sequence > max ? sequence : max;
  }, 0);

  return formatReportCardCode(yearSegment, maxSequence + 1);
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

export async function createCompanyWithReportCardId(input: Omit<CompanyCreateInput, 'company_code'> & { company_code?: string }): Promise<CompanyRow> {
  let companyCode = input.company_code ?? await generateNextReportCardId();

  for (let attempt = 0; attempt < REPORT_CARD_CODE_RETRY_LIMIT; attempt += 1) {
    const payload = {
      client_pipeline_status: 'Potential Client' as CompanyPipelineStatus,
      ...input,
      company_code: companyCode,
    };

    const { data, error } = await supabase.from('companies').insert(payload).select('*').single();

    if (!error) {
      return data as CompanyRow;
    }

    if (!isCompanyCodeConflict(error)) {
      throwSupabaseError('createCompanyWithReportCardId', error);
    }

    companyCode = await generateNextReportCardId();
  }

  throw new Error('createCompanyWithReportCardId failed: could not generate a unique Report Card ID.');
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

export async function getCompanyByCode(companyCode: string): Promise<CompanyRow | null> {
  const { data, error } = await supabase.from('companies').select('*').eq('company_code', companyCode).maybeSingle();

  if (error) {
    throwSupabaseError('getCompanyByCode', error);
  }

  return (data as CompanyRow | null) ?? null;
}

export async function getCompanyById(companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();

  if (error) {
    throwSupabaseError('getCompanyById', error);
  }

  return (data as CompanyRow | null) ?? null;
}
