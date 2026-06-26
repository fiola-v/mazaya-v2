import { supabase } from '../../db/supabase';
import { CompanyContactRow, DecisionMakerStatus } from '../../types/mazaya';

export interface CompanyContactCreateInput {
  company_id: string;
  contact_name: string;
  role_title?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  decision_maker_status?: DecisionMakerStatus | null;
  is_main_contact?: boolean;
  notes?: string | null;
}

export interface CompanyContactUpdateInput {
  company_id?: string;
  contact_name?: string;
  role_title?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  decision_maker_status?: DecisionMakerStatus | null;
  is_main_contact?: boolean;
  notes?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function createCompanyContact(input: CompanyContactCreateInput): Promise<CompanyContactRow> {
  const { data, error } = await supabase.from('company_contacts').insert(input).select('*').single();

  if (error) {
    throwSupabaseError('createCompanyContact', error);
  }

  return data as CompanyContactRow;
}

export async function updateCompanyContact(contactId: string, input: CompanyContactUpdateInput): Promise<CompanyContactRow> {
  const { data, error } = await supabase
    .from('company_contacts')
    .update(input)
    .eq('id', contactId)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('updateCompanyContact', error);
  }

  return data as CompanyContactRow;
}

export async function getMainContactForCompany(companyId: string): Promise<CompanyContactRow | null> {
  const { data, error } = await supabase
    .from('company_contacts')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_main_contact', true)
    .maybeSingle();

  if (error) {
    throwSupabaseError('getMainContactForCompany', error);
  }

  return (data as CompanyContactRow | null) ?? null;
}

export async function setMainContact(companyId: string, contactId: string): Promise<CompanyContactRow> {
  const { data: contact, error: contactError } = await supabase
    .from('company_contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();

  if (contactError) {
    throwSupabaseError('setMainContact(validate)', contactError);
  }

  if (!contact) {
    throw new Error(`setMainContact failed: contact ${contactId} was not found.`);
  }

  if (contact.company_id !== companyId) {
    throw new Error(
      `setMainContact failed: contact ${contactId} belongs to company ${contact.company_id}, not ${companyId}.`
    );
  }

  const resetPromise = supabase.from('company_contacts').update({ is_main_contact: false }).eq('company_id', companyId);
  const setPromise = supabase.from('company_contacts').update({ is_main_contact: true }).eq('id', contactId).select('*').single();

  const [{ error: resetError }, { data, error: setError }] = await Promise.all([resetPromise, setPromise]);

  if (resetError) {
    throwSupabaseError('setMainContact(reset)', resetError);
  }

  if (setError) {
    throwSupabaseError('setMainContact', setError);
  }

  const updatedContact = data as CompanyContactRow;

  const { error: companyUpdateError } = await supabase
    .from('companies')
    .update({ main_contact_id: updatedContact.id })
    .eq('id', companyId);

  if (companyUpdateError) {
    throwSupabaseError('setMainContact(company_update)', companyUpdateError);
  }

  return updatedContact;
}
