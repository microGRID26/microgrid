/**
 * Upload project folder links to Supabase project_folders table.
 * 
 * Usage:
 *   source <(grep -v '^#' .env.local | sed 's/^/export /')
 *   npx tsx scripts/upload-project-folders.ts /Users/gregkelsch/Downloads/bludocs_inventory/all_project_folders.json
 */

import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const BATCH_SIZE = 200

interface FolderRecord {
  project_id: string
  folder_id: string
  folder_url: string
  source: string
  file_count: number
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: npx tsx scripts/upload-project-folders.ts <all_project_folders.json>')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('ERROR: Missing env vars. Run: source <(grep -v "^#" .env.local | sed "s/^/export /")')
    process.exit(1)
  }

  const supabase = createClient(url, key)

  console.log(`Reading ${inputPath}...`)
  const records: FolderRecord[] = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))
  console.log(`Found ${records.length} project folder records.`)

  // Check what already exists
  const { count } = await (supabase as any)
    .from('project_folders')
    .select('*', { count: 'exact', head: true })
  console.log(`Existing records in project_folders: ${count ?? 'unknown'}`)

  // Transform to project_folders schema
  const rows = records.map(r => ({
    project_id: r.project_id,
    folder_url: r.folder_url,
  }))

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    const { error } = await (supabase as any)
      .from('project_folders')
      .upsert(batch, { onConflict: 'project_id', ignoreDuplicates: false })

    if (error) {
      errors += batch.length
      if (errors <= BATCH_SIZE * 3) {
        console.error(`  ERROR batch ${i}-${i + batch.length}: ${error.message}`)
      }
    } else {
      inserted += batch.length
    }

    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} (${inserted} upserted, ${errors} errors)`)
    }
  }

  console.log(`\n=== Upload Complete ===`)
  console.log(`Total records: ${rows.length}`)
  console.log(`Upserted:      ${inserted}`)
  console.log(`Errors:        ${errors}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
