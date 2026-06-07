import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle, Upload, ArrowUpCircle, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface Withdrawal {
  id: string;
  customer_id: string;
  amount: number;
  payment_details: string;
  status: string;
  proof_url: string | null;
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
  network: string | null;
  asset: string | null;
  binance_withdraw_id: string | null;
  txn_hash: string | null;
  error_message: string | null;
  auto_attempted: boolean;
  customer?: { chat_id: number; username: string | null; first_name: string | null };
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const WithdrawalsTab = () => {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<Withdrawal | null>(null);
  const [rejectDialog, setRejectDialog] = useState<Withdrawal | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchWithdrawals();
    const interval = setInterval(fetchWithdrawals, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchWithdrawals = async () => {
    const { data } = await supabase
      .from('bot_withdrawals')
      .select('*, customer:bot_customers(chat_id, username, first_name)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setWithdrawals(data as any);
    setLoading(false);
  };

  const getCustomerLabel = (item: Withdrawal) => {
    if (item.customer?.username) return `@${item.customer.username}`;
    if (item.customer?.first_name) return item.customer.first_name;
    return `#${item.customer?.chat_id || '?'}`;
  };

  const handleConfirm = async () => {
    if (!confirmDialog) return;
    setConfirming(true);

    try {
      let proofUrl: string | null = null;

      // Upload proof image if provided
      if (proofFile) {
        const ext = proofFile.name.split('.').pop() || 'png';
        const filePath = `withdrawals/${confirmDialog.id}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('instruction-media')
          .upload(filePath, proofFile, { upsert: true });
        if (uploadErr) throw new Error('Failed to upload proof image');
        const { data: urlData } = supabase.storage.from('instruction-media').getPublicUrl(filePath);
        proofUrl = urlData.publicUrl;
      }

      const { data, error } = await supabase.functions.invoke('admin-confirm-withdrawal', {
        body: {
          withdrawal_id: confirmDialog.id,
          proof_url: proofUrl,
          admin_note: adminNote.trim() || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Withdrawal confirmed & user notified!');
      setConfirmDialog(null);
      setAdminNote('');
      setProofFile(null);
      fetchWithdrawals();
    } catch (err: any) {
      toast.error(err.message || 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  const handleReject = async () => {
    if (!rejectDialog) return;
    setRejecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-reject-withdrawal', {
        body: { withdrawal_id: rejectDialog.id, note: rejectNote.trim() || null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Withdrawal rejected & balance refunded!');
      setRejectDialog(null);
      setRejectNote('');
      fetchWithdrawals();
    } catch (err: any) {
      toast.error(err.message || 'Rejection failed');
    } finally {
      setRejecting(false);
    }
  };

  const pendingCount = withdrawals.filter(w => w.status === 'pending').length;

  if (loading) {
    return <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpCircle className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground font-medium">
          Total: {withdrawals.length} withdrawals
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2 bg-yellow-500/20 text-yellow-400">{pendingCount} pending</Badge>
          )}
        </span>
      </div>

      {withdrawals.length === 0 ? (
        <div className="py-20 text-center"><p className="text-lg text-muted-foreground">No withdrawal requests yet.</p></div>
      ) : (
        <div className="space-y-2">
          {withdrawals.map((w) => {
            const statusClass =
              w.status === 'completed' ? 'bg-success text-success-foreground' :
              w.status === 'rejected' ? 'bg-muted text-muted-foreground' :
              'bg-yellow-500/20 text-yellow-400';
            return (
              <div key={w.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="secondary" className={statusClass}>{w.status}</Badge>
                  <span className="font-semibold text-foreground">{Number(w.amount).toFixed(2)} USDT</span>
                  <span className="text-sm text-muted-foreground">{getCustomerLabel(w)}</span>
                  <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground truncate max-w-[250px]">
                    {w.payment_details}
                  </code>
                  {w.status === 'pending' && (
                    <>
                      <Button size="sm" variant="outline"
                        className="gap-1 text-xs border-green-500/50 text-green-400 hover:bg-green-500/10"
                        onClick={() => { setConfirmDialog(w); setAdminNote(''); setProofFile(null); }}>
                        <CheckCircle className="h-3 w-3" />
                        Confirm
                      </Button>
                      <Button size="sm" variant="outline"
                        className="gap-1 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                        onClick={() => { setRejectDialog(w); setRejectNote(''); }}>
                        <XCircle className="h-3 w-3" />
                        Reject
                      </Button>
                    </>
                  )}
                  <span className="ml-auto text-sm text-muted-foreground">{formatDate(w.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Withdrawal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Customer: <span className="font-semibold text-foreground">{confirmDialog && getCustomerLabel(confirmDialog)}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Amount: <span className="font-semibold text-foreground">{confirmDialog && Number(confirmDialog.amount).toFixed(2)} USDT</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Payment Details: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{confirmDialog?.payment_details}</code>
            </div>
            <div>
              <label className="text-sm font-medium">Proof Image (screenshot of payment)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setProofFile(e.target.files?.[0] || null)}
              />
              <div className="mt-1 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3" />
                  {proofFile ? proofFile.name : 'Upload Image'}
                </Button>
                {proofFile && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setProofFile(null)}>Remove</Button>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Admin Note (optional)</label>
              <Textarea
                placeholder="e.g. Sent via Binance, TxID: abc..."
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Confirm & Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(open) => { if (!open) setRejectDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Withdrawal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Customer: <span className="font-semibold text-foreground">{rejectDialog && getCustomerLabel(rejectDialog)}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Amount: <span className="font-semibold text-foreground">{rejectDialog && Number(rejectDialog.amount).toFixed(2)} USDT</span>
              <br /><span className="text-xs text-yellow-400">Balance will be refunded automatically.</span>
            </div>
            <div>
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea
                placeholder="e.g. Invalid payment details, suspicious activity..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
              Reject & Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WithdrawalsTab;
