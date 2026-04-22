import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Play, ArrowDownRight, ArrowLeft, Copy, Check, Upload, X, Loader2, Building2, RefreshCw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

const quickAmounts = [1000, 2000, 5000, 10000, 20000, 50000]

interface Deposit {
  id: string
  amount_kobo: number
  status: string
  method: string
  created_at: string
}

interface AdminWallet {
  wallet_address: string
  network: string
}

export default function AddFunds() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'amount' | 'payment'>('amount')
  const [showBankModal, setShowBankModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Real data state
  const [recentDeposits, setRecentDeposits] = useState<Deposit[]>([])
  const [pocketfiActive, setPocketfiActive] = useState(true)
  const [loadingInit, setLoadingInit] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // PocketFi bank transfer state
  const [bankAccount, setBankAccount] = useState<{ accountNumber: string; accountName: string; bankName: string } | null>(null)
  const [loadingBankAccount, setLoadingBankAccount] = useState(false)
  const [bankCopied, setBankCopied] = useState(false)
  const [pollingDeposit, setPollingDeposit] = useState(false)
  // Timestamp when user entered the bank step — only deposits AFTER this count
  const bankStepEnteredAt = useRef<Date | null>(null)

  // Fetch payment methods, admin wallets, recent deposits
  useEffect(() => {
    async function fetchInitData() {
      try {
        const [methodsRes, adminWalletRes, depositsRes] = await Promise.all([
          supabase.functions.invoke('payment-methods', { method: 'GET' }),
          supabase.functions.invoke('wallet?type=admin', { method: 'GET' }),
          supabase.functions.invoke('deposits', { method: 'GET' }),
        ])

        // Payment methods — check which are active
        if (methodsRes.data?.success) {
          const methods = methodsRes.data.payments || []
          const pf = methods.find((m: Record<string, unknown>) => String(m.name).toLowerCase() === 'pocketfi')
          setPocketfiActive(pf?.status === 'active')
        }

        // Admin wallets — find crypto address
        if (adminWalletRes.data?.success) {
          const wallets: AdminWallet[] = adminWalletRes.data.wallets || []
          if (wallets.length > 0 && wallets[0].wallet_address) {
            setAdminWalletAddress(wallets[0].wallet_address)
          } else {
            setAdminWalletAddress('Not configured — contact admin')
          }
        }

        // Recent deposits
        if (depositsRes.data?.success) {
          setRecentDeposits((depositsRes.data.deposits || []).slice(0, 5))
        }
      } catch {
        console.error('Failed to load AddFunds data')
      } finally {
        setLoadingInit(false)
      }
    }

    if (user) fetchInitData()
  }, [user])

  function handleContinue() {
    if (!amount || Number(amount) <= 0) return
    setErrorMsg('')
    setStep('payment')
  }

  // PocketFi bank transfer — get or create virtual account
  async function handleBankTransfer() {
    setLoadingBankAccount(true)
    setErrorMsg('')
    try {
     const res = await fetch('/api/pocketfi-account', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({
         userId: user.id,
         email: user.email,
         username: user.user_metadata?.username || 'User',
       }),
     })

     const data = await res.json()

     if (!data.success) {
       setErrorMsg('Failed to get bank account')
       return
     }

     setBankAccount(data.account)
     setShowBankModal(true)
    } catch {
      setErrorMsg('Failed to connect to payment service')
    } finally {
      setLoadingBankAccount(false)
    }
  }

  function copyBankAccount() {
    if (!bankAccount) return
    navigator.clipboard.writeText(bankAccount.accountNumber)
    setBankCopied(true)
    setTimeout(() => setBankCopied(false), 2000)
  }

  // Poll for deposit confirmation after bank transfer
  const checkForNewDeposit = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke('deposits', { method: 'GET' })
      if (data?.success) {
        const deposits: Deposit[] = data.deposits || []
        const enteredAt = bankStepEnteredAt.current
        const recent = deposits.find(
          (d) =>
            d.method === 'pocketfi' &&
            d.status === 'success' &&
            // Only match deposits created AFTER the user landed on this bank step
            enteredAt !== null &&
            new Date(d.created_at) > enteredAt
        )
        if (recent) {
          setPollingDeposit(false)
          setSubmitted(true)
          setRecentDeposits(deposits.slice(0, 5))
          return true
        }
      }
    } catch { /* ignore */ }
    return false
  }, [])

  // Auto-poll when bank modal is open
  useEffect(() => {
    if (!showBankModal || !bankAccount || submitted) return
    setPollingDeposit(true)
    // Check immediately, then every 5s
    checkForNewDeposit()
    const interval = setInterval(async () => {
      const found = await checkForNewDeposit()
      if (found) clearInterval(interval)
    }, 5000) // check every 5s
    return () => { clearInterval(interval); setPollingDeposit(false) }
  }, [showBankModal, bankAccount, submitted, checkForNewDeposit])

  return (
    <div className="space-y-6 animate-[fadeSlideUp_0.5s_ease-out]">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-indigo-600 to-purple-700 p-6 sm:p-8 text-white shadow-2xl shadow-primary-600/20">
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/10 -translate-y-10 translate-x-10" />
        <div className="absolute bottom-0 left-1/4 w-24 h-24 rounded-full bg-white/5 translate-y-8" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg border border-white/10">
            <Wallet size={22} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Fund Wallet</h1>
            <p className="text-white/60 text-sm">Top up your wallet instantly</p>
          </div>
        </div>
      </div>

      {/* Amount Input / Payment Method */}
      {step === 'amount' ? (
        <>
          <div className="bg-white dark:bg-gray-800/80 backdrop-blur-sm border border-gray-100 dark:border-gray-700/30 rounded-3xl p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Enter Amount</h2>
            <div className="relative mb-5">
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="₦0.00"
                className="w-full text-center text-2xl sm:text-3xl font-bold py-5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600/50 rounded-2xl text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all"
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-center mb-5">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setAmount(String(amt))}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-600/50 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-all"
                >
                  ₦{amt.toLocaleString()}
                </button>
              ))}
            </div>
            <button
              onClick={handleContinue}
              disabled={!amount || Number(amount) <= 0}
              className="w-full py-3.5 rounded-2xl font-bold text-white bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 shadow-lg shadow-primary-600/20 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-lg"
            >
              Continue
            </button>
          </div>

          {/* Watch Tutorial */}
          <button className="flex items-center gap-2 mx-auto text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
            <Play size={16} />
            Watch Tutorial
          </button>
        </>
      ) : (
        <div className="bg-white dark:bg-gray-800/80 backdrop-blur-sm border border-gray-100 dark:border-gray-700/30 rounded-3xl p-6 sm:p-8 shadow-sm animate-[fadeSlideUp_0.3s_ease-out]">
          <button onClick={() => setStep('amount')} className="flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-5 transition-colors">
            <ArrowLeft size={18} />
            Select Payment Method
          </button>

          <div className="bg-gray-50 dark:bg-gray-700/30 rounded-2xl px-5 py-4 flex items-center justify-between mb-6">
            <span className="text-sm text-gray-500 dark:text-gray-400">Amount</span>
            <span className="text-lg font-bold text-gray-900 dark:text-white">₦{Number(amount).toLocaleString()}</span>
          </div>

          <h3 className="font-bold text-gray-900 dark:text-white mb-4">Choose Provider</h3>
          <div className="space-y-3">

            {/* Bank Transfer (Paga) */}
            {pocketfiActive && (
            <button
              onClick={handleBankTransfer}
              disabled={loadingBankAccount}
              className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 dark:border-gray-600/50 hover:border-emerald-300 dark:hover:border-emerald-700/50 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10 transition-all group disabled:opacity-50"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
                {loadingBankAccount ? <Loader2 size={20} className="text-white animate-spin" /> : <Building2 size={20} className="text-white" />}
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-gray-900 dark:text-white">Bank Transfer</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{loadingBankAccount ? 'Getting account...' : 'Transfer from any bank'}</p>
              </div>
              <span className="text-[10px] font-bold bg-emerald-500 text-white px-3 py-1 rounded-full shadow-sm">Auto</span>
            </button>
            )}
            
          </div>

          {errorMsg && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm text-red-600 dark:text-red-400">
              {errorMsg}
            </div>
          )}
        </div>
      )}

      {/* Bank Transfer Modal (Paga / PocketFi) */}
      {showBankModal && bankAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !submitted) { setShowBankModal(false); setBankAccount(null) } }}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Modal Card */}
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700/50 overflow-hidden animate-[fadeSlideUp_0.25s_ease-out]">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
                  <Building2 size={17} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Bank Transfer Details</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Transfer from any Nigerian bank</p>
                </div>
              </div>
              {!submitted && (
                <button
                  onClick={() => { setShowBankModal(false); setBankAccount(null) }}
                  className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="p-5">
              {!submitted ? (
                <>
                  {/* Amount pill */}
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-800/40 rounded-2xl px-4 py-3 flex items-center justify-between mb-5">
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Exact amount to send</span>
                    <span className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300">₦{Number(amount).toLocaleString()}</span>
                  </div>

                  {/* Account Number — hero element */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 mb-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold mb-2 block">Account Number</label>
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-black text-gray-900 dark:text-white tracking-widest flex-1 tabular-nums">{bankAccount.accountNumber}</span>
                      <button
                        onClick={copyBankAccount}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
                      >
                        {bankCopied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-5">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold mb-1 block">Account Name</label>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{bankAccount.accountName}</span>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-semibold mb-1 block">Bank</label>
                      <span className="text-sm font-bold text-gray-900 dark:text-white capitalize">{bankAccount.bankName}</span>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200/50 dark:border-blue-800/30 rounded-xl p-3 mb-5">
                    <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                      Transfer <span className="font-bold">exactly ₦{Number(amount).toLocaleString()}</span> to the account above. Your wallet credits automatically once confirmed.
                    </p>
                  </div>

                  {/* Polling indicator */}
                  <div className="flex items-center justify-center gap-2 mb-4">
                    {pollingDeposit ? (
                      <>
                        <RefreshCw size={13} className="text-emerald-500 animate-spin" />
                        <span className="text-xs text-gray-500 dark:text-gray-400">Waiting for confirmation...</span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">Wallet credits automatically after transfer</span>
                    )}
                  </div>

                  <button
                    onClick={async () => {
                      setPollingDeposit(true)
                      await checkForNewDeposit()
                      setPollingDeposit(false)
                    }}
                    className="w-full py-3 rounded-2xl font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <RefreshCw size={15} />
                    I've Sent the Money — Check Now
                  </button>
                </>
              ) : (
                /* Success state inside modal */
                <div className="py-6 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
                    <Check size={32} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Payment Received! 🎉</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
                    <span className="font-bold">₦{Number(amount).toLocaleString()}</span> has been confirmed and your wallet has been credited.
                  </p>
                  <button
                    onClick={() => { setShowBankModal(false); setBankAccount(null); setStep('amount'); setAmount(''); setSubmitted(false) }}
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:-translate-y-0.5"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white dark:bg-gray-800/80 backdrop-blur-sm border border-gray-100 dark:border-gray-700/30 rounded-3xl p-6 shadow-sm animate-[fadeSlideUp_0.5s_ease-out_0.1s_both]">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">Recent Transactions</h2>
        {loadingInit ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : recentDeposits.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No transactions yet</p>
        ) : (
          <div className="space-y-2">
            {recentDeposits.map((dep) => (
              <div key={dep.id} className="flex items-center justify-between py-3 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-900/30 dark:to-green-900/30 flex items-center justify-center">
                    <ArrowDownRight size={15} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200 capitalize">{dep.method || 'Deposit'}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{new Date(dep.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">₦{(dep.amount_kobo / 100).toLocaleString()}</p>
                  <p className={`text-[10px] font-medium ${dep.status === 'success' ? 'text-emerald-500' : dep.status === 'pending' ? 'text-amber-500' : 'text-gray-400'}`}>{dep.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
