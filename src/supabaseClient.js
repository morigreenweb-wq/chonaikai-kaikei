import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://nrvlzjxtsusytnvbbtga.supabase.co'
const SUPABASE_KEY = 'sb_publishable_oiyJm8ZkQyvPBPktCr5x2A_4dm9lpa6'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
