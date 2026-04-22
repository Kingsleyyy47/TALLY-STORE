import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

type PaymentStatus = 'processing' | 'success' | 'failed'

export default function PaymentProcessing() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const provider = searchParams.get('provider') || 'korapay'
  const reference = searchParams.get('ref') || searchParams.get('reference') || ''
  const [status, setStatus] = useState<PaymentStatus>('processing')
  const [amountKobo, setAmountKobo] = useState(0)
  const pollCount = useRef(0)
  const maxPolls = 20 // ~60 seconds at 3s intervals

  // Poll deposit status via Edge Function
  useEffect(() => {
    if (!reference) {
      // No reference = nothing to verify, fail after brief delay
      const timer = setTimeout(() => setStatus('failed'), 3000)
      return () => clearTimeout(timer)
    }

    const pollInterval = setInterval(async () => {
      pollCount.current += 1

      try {
        const { data, error } = await supabase.functions.invoke(
          `deposits?action=check-status&reference=${encodeURIComponent(reference)}`,
          { method: 'GET' }
        )

        if (error) {
          console.error('Poll error:', error)
          if (pollCount.current >= maxPolls) {
            clearInterval(pollInterval)
            setStatus('failed')
          }
          return
        }

        if (data?.status === 'success') {
          clearInterval(pollInterval)
          if (data?.amount) setAmountKobo(Number(data.amount))
          setStatus('success')
        } else if (data?.status === 'rejected' || data?.status === 'failed') {
          clearInterval(pollInterval)
          setStatus('failed')
        } else if (pollCount.current >= maxPolls) {
          clearInterval(pollInterval)
          setStatus('failed')
        }
        // If status is 'pending' or 'not_found', keep polling
      } catch (err) {
        console.error('Poll exception:', err)
        if (pollCount.current >= maxPolls) {
          clearInterval(pollInterval)
          setStatus('failed')
        }
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [reference])

  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => {
        navigate('/dashboard/payment-success?amount=' + amountKobo)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [status, navigate, amountKobo])

  return (
    <div className="min-h-[60vh] flex items-center justify-center animate-[fadeSlideUp_0.5s_ease-out]">
      <div className="bg-white dark:bg-gray-800/80 backdrop-blur-sm border border-gray-100 dark:border-gray-700/30 rounded-3xl p-10 sm:p-14 text-center max-w-md w-full shadow-sm">
        {status === 'processing' && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center">
              <Loader2 size={40} className="text-primary-600 dark:text-primary-400 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Processing Payment</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-2">
              Verifying your payment via {provider}...
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Please do not close this page</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center animate-[bounceIn_0.5s_ease-out]">
              <CheckCircle2 size={40} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Payment Confirmed!</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Redirecting you shortly...</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="w-20 h-20 mx-auto mb-6 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center">
              <XCircle size={40} className="text-red-500 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Payment Failed</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
              Your payment could not be verified. Please try again or contact support.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/dashboard/funds')}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
              >
                <ArrowLeft size={16} /> Try Again
              </button>
              <button
                onClick={() => navigate('/dashboard/support')}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white font-bold text-sm transition-all shadow-lg shadow-primary-600/20"
              >
                Contact Support
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
