import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rawBody = JSON.stringify(req.body)

    console.log('=== POCKETFI WEBHOOK RECEIVED ===')
    console.log(req.body)

    const secret = process.env.POCKETFI_SECRET_KEY
    const signature =
      req.headers['pocketfi_signature'] ||
      req.headers['x-pocketfi-signature'] ||
      req.headers['x-signature']

    if (secret && signature) {
      const computed = crypto
        .createHmac('sha512', secret)
        .update(rawBody)
        .digest('hex')

      if (computed !== String(signature).toLowerCase()) {
        return res.status(400).json({ status: 'invalid_signature' })
      }
    }

    const data = req.body.data || req.body

    const accountNumber =
      data.account_number ||
      data.accountNumber ||
      data.virtualAccountNumber

    const amount = parseFloat(data.amount || data.amountPaid || 0)

    const reference =
      data.reference ||
      data.transactionReference ||
      `PF_${Date.now()}`

    if (!accountNumber || !amount) {
      return res.json({ status: 'invalid_data' })
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('pocketfi_account_number', accountNumber)
      .single()

    if (!profile) {
      return res.json({ status: 'user_not_found' })
    }

    const amountKobo = Math.round(amount * 100)

    await supabase.from('deposits').insert({
      user_id: profile.id,
      amount_kobo: amountKobo,
      method: 'pocketfi',
      status: 'success',
      reference
    })

    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', profile.id)
      .single()

    if (!wallet) {
      return res.json({ status: 'wallet_not_found' })
    }

    await supabase
      .from('wallets')
      .update({
        balance: wallet.balance + amountKobo
      })
      .eq('user_id', profile.id)

    return res.json({ status: 'success' })

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'server_error' })
  }
}
