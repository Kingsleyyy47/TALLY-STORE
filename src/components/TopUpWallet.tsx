import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/SimpleAuth';
import { initiatePayment, type PaymentData } from '@/services/ercaspay';
import { useToast } from '@/hooks/use-toast';

interface TopUpWalletProps {
  onSuccess?: () => void;
}

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000, 50000];

export function TopUpWallet({ onSuccess }: TopUpWalletProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const handleQuickAmount = (quickAmount: number) => {
    setAmount(quickAmount.toString());
  };

  const handleTopUp = async () => {
    if (!user?.email) {
      toast({
        title: "Authentication Required",
        description: "Please log in to top up your wallet.",
        variant: "destructive",
      });
      return;
    }

    const topUpAmount = parseInt(amount);
    if (!topUpAmount || topUpAmount < 100) {
      toast({
        title: "Invalid Amount",
        description: "Please enter an amount of at least ₦100.",
        variant: "destructive",
      });
      return;
    }

    if (topUpAmount > 1000000) {
      toast({
        title: "Amount Too Large",
        description: "Maximum top-up amount is ₦1,000,000.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const paymentData: PaymentData = {
        amount: topUpAmount,
        customerName: 'Tally Store Customer', // Use a clean, simple name
        customerEmail: user.email,
        redirectUrl: `${window.location.origin}/wallet`, // Redirect back to wallet after payment
        description: `Wallet top-up of ₦${topUpAmount.toLocaleString()}`,
        feeBearer: "merchant",
        metadata: {
          user_id: user.id, // Use user_id to match webhook payload structure
          userId: user.id,  // Keep userId for backward compatibility
          type: 'wallet_topup',
          originalAmount: topUpAmount
        }
      };

      console.log('🚀 Initiating wallet top-up...', paymentData);

      const response = await initiatePayment(paymentData);

      if (response.success && response.data?.checkoutUrl) {
        // Store transaction reference for verification later
        localStorage.setItem('pending_topup', JSON.stringify({
          transactionReference: response.data.transactionReference,
          amount: topUpAmount,
          timestamp: Date.now()
        }));


        // Open payment page in new tab instead of redirecting, redirecting causing pop up customers complaining
        
        const checkoutUrl =
          response?.data?.checkoutUrl ??
          response?.data?.data?.checkoutUrl ?? null;
        
        console.log('Checkout URL →', checkoutUrl);
        
        if (!checkoutUrl || !/^https?:\/\//.test(checkoutUrl)) {
          toast({
            variant: "destructive",
            title: "Invalid checkout URL",
            description: "Payment link is missing or malformed."
          });
          setIsLoading(false);
          return;
        }
        
        window.location.assign(checkoutUrl); // same tab (no pop-up)
        
        // Close the modal and show instructions
        setIsOpen(false);
        toast({
          title: "Payment Window Opened",
          description: "Complete your payment in the new tab. Your wallet will update automatically when payment is successful.",
        });
      } else {
        throw new Error(response.error || 'Failed to initiate payment');
      }

    } catch (error: any) {
      console.error('❌ Top-up error:', error);
      toast({
        title: "Payment Failed",
        description: error.message || "Failed to initiate payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
    }).format(value);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" size="lg">
          <Plus className="mr-2 h-4 w-4" />
          Top Up Wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Top Up Wallet
          </DialogTitle>
          <DialogDescription>
            Add money to your wallet to purchase social media accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Quick Amount Buttons */}
          <div className="space-y-3">
            <Label>Quick Amounts</Label>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((quickAmount) => (
                <Button
                  key={quickAmount}
                  variant={amount === quickAmount.toString() ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleQuickAmount(quickAmount)}
                  className="text-xs"
                >
                  {formatCurrency(quickAmount)}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Custom Amount (₦)</Label>
            <Input
              id="amount"
              type="number"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="100"
              max="1000000"
            />
            <p className="text-xs text-muted-foreground">
              Minimum: ₦100, Maximum: ₦1,000,000
            </p>
          </div>

          {/* Payment Summary */}
          {amount && parseInt(amount) >= 100 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Payment Summary</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Amount:</span>
                    <span className="font-medium">{formatCurrency(parseInt(amount))}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Payment Methods:</span>
                    <span>Card, Bank Transfer, USSD</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              className="flex-1"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleTopUp}
              disabled={!amount || parseInt(amount) < 100 || isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                'Proceed to Payment'
              )}
            </Button>
          </div>

          {/* Security Note */}
          <div className="text-xs text-muted-foreground text-center">
            🔒 Secure payment powered by Ercas Pay
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
