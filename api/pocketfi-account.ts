import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // ⚠️ You should replace this with real auth later
    const { userId, email, username } = req.body

    if (!userId || !email) {
      return res.status(400).json({ error: 'Missing user data' })
    }

    // 1️⃣ Check if user already has account
    const { data: profile } = await supabase
      .from('profiles')
      .select('pocketfi_account_number, pocketfi_account_name, pocketfi_bank')
      .eq('id', userId)
      .single()

    if (profile?.pocketfi_account_number) {
      return res.json({
        success: true,
        cached: true,
        account: {
          accountNumber: profile.pocketfi_account_number,
          accountName: profile.pocketfi_account_name,
          bankName: profile.pocketfi_bank,
        },
      })
    }

    // 2️⃣ Create account via PocketFi
    const response = await fetch('https://api.pocketfi.ng/api/v1/virtual-accounts/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.POCKETFI_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        first_name: username || 'User',
        last_name: 'User',
        phone: '09000000000',
        email,
        businessId: process.env.POCKETFI_BUSINESS_ID,
        bank: 'paga',
      }),
    })

    const result = await response.json()

    if (!result.status || !result.banks?.length) {
      return res.status(500).json({ error: 'Failed to create account' })
    }

    const bank = result.banks[0]

    // 3️⃣ Save to DB
    await supabase
      .from('profiles')
      .update({
        pocketfi_account_number: bank.accountNumber,
        pocketfi_account_name: bank.accountName,
        pocketfi_bank: bank.bankName,
      })
      .eq('id', userId)

    return res.json({
      success: true,
      cached: false,
      account: {
        accountNumber: bank.accountNumber,
        accountName: bank.accountName,
        bankName: bank.bankName,
      },
    })

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'server_error' })
  }
}
