/**
 * Customer feedback submission helpers.
 *
 * Handles:
 *   - Submitting feedback rows to customer_feedback
 *   - Uploading screenshots to the customer-feedback Storage bucket
 *   - Capturing device + app + screen context automatically
 */

import { supabase } from './supabase'
import { getCustomerAccount } from './api'
import Constants from 'expo-constants'
import * as Device from 'expo-device'

export type FeedbackCategory = 'bug' | 'idea' | 'praise' | 'question' | 'confusing'

export interface FeedbackSubmission {
  category: FeedbackCategory
  message: string
  rating?: number | null
  screenPath?: string
  attachments?: { uri: string; mimeType?: string; fileName?: string }[]
}

export interface FeedbackRow {
  id: string
  customer_account_id: string
  project_id: string
  category: FeedbackCategory
  rating: number | null
  message: string
  screen_path: string | null
  app_version: string | null
  device_info: string | null
  status: 'new' | 'reviewing' | 'responded' | 'closed'
  admin_response: string | null
  admin_responded_by: string | null
  admin_responded_at: string | null
  org_id: string | null
  created_at: string
}

/** Build a human-readable device info string */
function getDeviceInfo(): string {
  const os = `${Device.osName ?? 'Unknown'} ${Device.osVersion ?? ''}`.trim()
  const model = Device.modelName ?? Device.deviceName ?? 'Unknown device'
  return `${os} · ${model}`
}

/** Get the running app version from Expo config */
function getAppVersion(): string {
  return (
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    'unknown'
  )
}

/**
 * Upload a single screenshot/file to the customer-feedback bucket.
 * Returns the public URL + size on success, null on failure.
 * Matches the uploadTicketPhoto pattern in lib/api.ts.
 */
async function uploadAttachment(
  feedbackId: string,
  uri: string,
  fileName: string,
  mimeType: string,
): Promise<{ url: string; size: number } | null> {
  try {
    const response = await fetch(uri)
    const arrayBuffer = await response.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    const path = `${feedbackId}/${Date.now()}-${fileName}`
    const { error: uploadError } = await supabase.storage
      .from('customer-feedback')
      .upload(path, uint8, { contentType: mimeType, upsert: false })

    if (uploadError) {
      console.error('[feedback] upload failed:', uploadError.message)
      return null
    }

    const { data: urlData } = supabase.storage
      .from('customer-feedback')
      .getPublicUrl(path)

    return { url: urlData.publicUrl, size: uint8.byteLength }
  } catch (err) {
    console.error('[feedback] upload exception:', err instanceof Error ? err.message : err)
    return null
  }
}

export interface SubmitResult {
  /** Inserted feedback row id, or null if the insert failed */
  feedbackId: string | null
  /** Number of attachments that uploaded successfully */
  attachmentsUploaded: number
  /** Number of attachments that failed to upload (still submitted, just no screenshot) */
  attachmentsFailed: number
}

/**
 * Submit feedback (with optional attachments) for the current customer.
 *
 * Returns a SubmitResult so the UI can show partial-success when some
 * attachments fail. The feedback row is always inserted first; attachment
 * upload failures don't block submission.
 */
export async function submitFeedback(input: FeedbackSubmission): Promise<SubmitResult> {
  const result: SubmitResult = { feedbackId: null, attachmentsUploaded: 0, attachmentsFailed: 0 }

  const account = await getCustomerAccount()
  if (!account) {
    console.error('[feedback] no customer account — cannot submit')
    return result
  }

  // Look up org_id from project so RLS gives CRM users visibility
  const { data: proj, error: projError } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', account.project_id)
    .single()

  if (projError) {
    console.warn('[feedback] could not determine org_id:', projError.message)
  }
  const orgId = (proj as { org_id: string | null } | null)?.org_id ?? null

  const { data: inserted, error: insertError } = await supabase
    .from('customer_feedback')
    .insert({
      customer_account_id: account.id,
      project_id: account.project_id,
      category: input.category,
      rating: input.rating ?? null,
      message: input.message.trim(),
      screen_path: input.screenPath ?? null,
      app_version: getAppVersion(),
      device_info: getDeviceInfo(),
      status: 'new',
      org_id: orgId,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[feedback] insert failed:', insertError?.message)
    return result
  }

  const feedbackId = (inserted as { id: string }).id
  result.feedbackId = feedbackId

  // Upload attachments in parallel; track per-file success
  if (input.attachments && input.attachments.length > 0) {
    const settled = await Promise.allSettled(
      input.attachments.map(async (att, idx) => {
        const fileName = att.fileName ?? `screenshot-${idx + 1}.jpg`
        const mimeType = att.mimeType ?? 'image/jpeg'
        const upload = await uploadAttachment(feedbackId, att.uri, fileName, mimeType)
        if (!upload) throw new Error(`upload failed for ${fileName}`)
        const { error: attErr } = await supabase
          .from('customer_feedback_attachments')
          .insert({
            feedback_id: feedbackId,
            file_url: upload.url,
            file_name: fileName,
            mime_type: mimeType,
            file_size: upload.size,
          })
        if (attErr) throw new Error(`attachment row insert failed: ${attErr.message}`)
      }),
    )

    for (const s of settled) {
      if (s.status === 'fulfilled') result.attachmentsUploaded++
      else { result.attachmentsFailed++; console.error('[feedback]', s.reason) }
    }
  }

  return result
}
