import { supabase } from '../../db/supabase';
import { ReportSyncQueueRow, ReportSyncStatus } from '../../types/mazaya';

export interface ReportQueueCreateInput {
  entity_type: string;
  entity_id: string;
  change_type: string;
  status?: ReportSyncStatus;
  last_error?: string | null;
  synced_at?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function queueReportSync(input: ReportQueueCreateInput): Promise<ReportSyncQueueRow> {
  const payload = {
    status: 'Pending' as ReportSyncStatus,
    attempts: 0,
    ...input,
  };

  const { data, error } = await supabase.from('report_sync_queue').insert(payload).select('*').single();

  if (error) {
    throwSupabaseError('queueReportSync', error);
  }

  return data as ReportSyncQueueRow;
}

export async function markReportSyncSynced(id: string): Promise<ReportSyncQueueRow> {
  const { data, error } = await supabase
    .from('report_sync_queue')
    .update({
      status: 'Synced',
      synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('markReportSyncSynced', error);
  }

  return data as ReportSyncQueueRow;
}

export async function markReportSyncFailed(id: string, errorMessage: string): Promise<ReportSyncQueueRow> {
  const { data, error } = await supabase
    .from('report_sync_queue')
    .update({
      status: 'Failed',
      last_error: errorMessage,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('markReportSyncFailed', error);
  }

  return data as ReportSyncQueueRow;
}

export async function listPendingReportSyncItems(): Promise<ReportSyncQueueRow[]> {
  const { data, error } = await supabase
    .from('report_sync_queue')
    .select('*')
    .eq('status', 'Pending')
    .order('created_at', { ascending: true });

  if (error) {
    throwSupabaseError('listPendingReportSyncItems', error);
  }

  return (data ?? []) as ReportSyncQueueRow[];
}
