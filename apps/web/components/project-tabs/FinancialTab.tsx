'use client';

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
    CheckCircle2, TrendingUp, Wallet,
    ArrowUpRight, ArrowDownLeft, Calendar, Filter, Search, Image as ImageIcon, ExternalLink, MessageSquare, Plus, Pencil, Trash, ArrowUpDown, Package, Users, Calculator
} from "lucide-react";

type Transaction = {
    transaction_id: number;
    created_at: string;
    transaction_date: string;
    created_by_name: string;
    vendor_name: string;
    description: string;
    payment_channel: string;
    amount: number;
    receipt_url: string | null;
    order_reference: string;
    user_name: string;
    category: string;
    type: string;
    comments: string | null;
};

const STICKY_ACTION_CELL_CLASS =
    "sticky right-0 z-10 bg-white shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.2)]";

export default function FinancialTab({ projectId }: { projectId: string }) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [quotesTotal, setQuotesTotal] = useState<number>(0);
    const [costSummary, setCostSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [costLoading, setCostLoading] = useState(true);

    const [txFilters, setTxFilters] = useState({
        createdOn: '',
        transactionDate: '',
        createdBy: '',
        vendor: '',
        description: '',
        channel: '',
        user: '',
        order: '',
    });

    const [txSort, setTxSort] = useState<{ key: 'amount'; direction: 'asc' | 'desc' } | null>(null);

    // Payment Form State
    const [isPaymentOpen, setIsPaymentOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [currentTransactionId, setCurrentTransactionId] = useState<number | null>(null);
    const [newPayment, setNewPayment] = useState({
        vendor_name: '',
        amount: '',
        description: '',
        type: 'Debit', // Default
        category: 'VendorPayment', // Default
        receipt_url: ''
    });
    const [receiptFile, setReceiptFile] = useState<File | null>(null);

    // Comment State
    const [isCommentOpen, setIsCommentOpen] = useState(false);
    const [commentText, setCommentText] = useState("");
    const [activeCommentId, setActiveCommentId] = useState<number | null>(null);

    // View Details State
    const [viewTransaction, setViewTransaction] = useState<Transaction | null>(null);

    const formatCurrency = (amount: number) => {
        return "₹ " + new Intl.NumberFormat('en-IN').format(amount);
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return "";
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };

    const fetchCostingSummary = async () => {
        setCostLoading(true);
        const { data, error } = await supabase
            .from('project_costing_summary')
            .select('*')
            .eq('project_id', projectId)
            .single();

        if (!error && data) {
            setCostSummary(data);
        }
        setCostLoading(false);
    };

    const fetchFinancialData = async () => {
        setLoading(true);
        // Fetch Transactions
        const { data: txData, error: txError } = await supabase
            .from('transactions')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (txData) {
            setTransactions(txData);
        }

        // Fetch Project Quotes
        const { data: quoteData, error: quoteError } = await supabase
            .from('project_quotes')
            .select('total_amount')
            .eq('project_id', projectId);

        if (quoteData) {
            const total = quoteData.reduce((sum, item) => sum + (item.total_amount || 0), 0);
            setQuotesTotal(total);
        }
        
        // Fetch Cost Summary
        await fetchCostingSummary();
        
        setLoading(false);
    };

    useEffect(() => {
        if (projectId) {
            fetchFinancialData();
        }
    }, [projectId]);

    const handleTxFilterChange = (key: keyof typeof txFilters, value: string) => {
        setTxFilters((prev) => ({ ...prev, [key]: value }));
    };

    const filteredTransactions = transactions.filter((t) => {
        const createdAtDate = (t.created_at || '').slice(0, 10); // YYYY-MM-DD
        const transactionDate = (t.transaction_date || '').slice(0, 10); // YYYY-MM-DD

        const createdBy = String(t.created_by_name || '').toLowerCase();
        const vendor = String(t.vendor_name || '').toLowerCase();
        const description = String(t.description || '').toLowerCase();
        const channel = String(t.payment_channel || '').toLowerCase();
        const user = String(t.user_name || '').toLowerCase();
        const order = String(t.order_reference || '').toLowerCase();

        const createdOnFilter = txFilters.createdOn.trim();
        const transactionDateFilter = txFilters.transactionDate.trim();

        const createdByFilter = txFilters.createdBy.trim().toLowerCase();
        const vendorFilter = txFilters.vendor.trim().toLowerCase();
        const descriptionFilter = txFilters.description.trim().toLowerCase();
        const channelFilter = txFilters.channel.trim().toLowerCase();
        const userFilter = txFilters.user.trim().toLowerCase();
        const orderFilter = txFilters.order.trim().toLowerCase();

        return (
            (!createdOnFilter || createdAtDate === createdOnFilter) &&
            (!transactionDateFilter || transactionDate === transactionDateFilter) &&
            (!createdByFilter || createdBy.includes(createdByFilter)) &&
            (!vendorFilter || vendor.includes(vendorFilter)) &&
            (!descriptionFilter || description.includes(descriptionFilter)) &&
            (!channelFilter || channel.includes(channelFilter)) &&
            (!userFilter || user.includes(userFilter)) &&
            (!orderFilter || order.includes(orderFilter))
        );
    });

    const sortedTransactions = (() => {
        if (!txSort) return filteredTransactions;
        const dir = txSort.direction === 'asc' ? 1 : -1;
        return [...filteredTransactions].sort((a, b) => {
            const av = Number(a.amount ?? 0);
            const bv = Number(b.amount ?? 0);
            return (av - bv) * dir;
        });
    })();

    const handleEditTransaction = (transaction: Transaction) => {
        setCurrentTransactionId(transaction.transaction_id);
        setNewPayment({
            vendor_name: transaction.vendor_name || "",
            amount: Math.abs(transaction.amount).toString(),
            description: transaction.description || "",
            type: transaction.amount < 0 ? 'Debit' : 'Credit',
            category: (transaction.category as any) || 'VendorPayment',
            receipt_url: transaction.receipt_url || ''
        });
        setReceiptFile(null); // Reset file on edit open
        setIsPaymentOpen(true);
    };

    const handlePayment = async () => {
        if (isSaving) return;

        if (!newPayment.vendor_name || !newPayment.amount || !newPayment.description) {
            toast.error("Please fill in all required fields.");
            return;
        }

        setIsSaving(true);

        const amountValue = Number(newPayment.amount);
        let finalAmount = Math.abs(amountValue);
        if (newPayment.type === 'Debit') {
            finalAmount = -finalAmount;
        }

        // Best-effort: stamp current logged-in user info (no hard dependency on profiles RLS)
        let createdByName = "Current User";
        let accountEmail = "Current User";
        try {
            const { data: authData } = await supabase.auth.getUser();
            const user = authData?.user;
            if (user?.email) {
                createdByName = user.email;
                accountEmail = user.email;
            }
            if (user?.id) {
                const { data: prof } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('user_id', user.id)
                    .limit(1);
                const fullName = String(prof?.[0]?.full_name || '').trim();
                if (fullName) createdByName = fullName;
            }
        } catch {
            // ignore and keep placeholders
        }

        const paymentPayload = {
            transaction_date: new Date().toISOString().split('T')[0],
            created_by_name: createdByName,
            vendor_name: newPayment.vendor_name,
            description: newPayment.description,
            payment_channel: "Manual",
            amount: finalAmount,
            type: newPayment.type,
            category: newPayment.category,
            user_name: accountEmail,
            project_id: Number(projectId),
            receipt_url: newPayment.receipt_url
        };

        // Upload Receipt if file exists
        if (receiptFile) {
            const fileExt = receiptFile.name.split('.').pop();
            const fileName = `${projectId}-${Date.now()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('receipts')
                .upload(fileName, receiptFile);

            if (uploadError) {
                console.error("Error uploading receipt:", uploadError);
                toast.error("Failed to upload receipt image.");
                setIsSaving(false);
                return;
            }

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(fileName);
            paymentPayload.receipt_url = publicUrl;
        }

        let error;

        if (currentTransactionId) {
            // Update existing
            const { error: updateError } = await supabase
                .from('transactions')
                .update(paymentPayload)
                .eq('transaction_id', currentTransactionId);
            error = updateError;
        } else {
            // Create new
            const { error: insertError } = await supabase.from('transactions').insert([paymentPayload]);
            error = insertError;
        }

        if (!error) {
            toast.success(currentTransactionId ? "Transaction updated successfully." : "Payment saved successfully.");
            setIsPaymentOpen(false);
            setNewPayment({ vendor_name: '', amount: '', description: '', type: 'Debit', category: 'VendorPayment', receipt_url: '' }); // Reset
            setReceiptFile(null);
            setCurrentTransactionId(null);
            fetchFinancialData(); // Refresh
        } else {
            console.error("Error adding payment:", error);
            toast.error("Failed to add payment.");
        }
        setIsSaving(false);
    };

    const handleDeleteTransaction = async (id: number) => {
        const { error } = await supabase.from('transactions').delete().eq('transaction_id', id);

        if (!error) {
            toast.success("Transaction deleted successfully");
            fetchFinancialData();
        } else {
            console.error("Error deleting transaction:", error);
            toast.error("Failed to delete transaction");
        }
    };

    const openCommentDialog = (transaction: Transaction) => {
        setActiveCommentId(transaction.transaction_id);
        setCommentText(transaction.comments || "");
        setIsCommentOpen(true);
    };

    const handleSaveComment = async () => {
        if (!activeCommentId) return;
        setIsSaving(true);

        const { error } = await supabase
            .from('transactions')
            .update({ comments: commentText })
            .eq('transaction_id', activeCommentId);

        if (!error) {
            toast.success("Comment updated successfully");
            setIsCommentOpen(false);
            fetchFinancialData();
        } else {
            console.error("Error updating comment:", error);
            toast.error("Failed to update comment");
        }
        setIsSaving(false);
    };

    const handleDeleteComment = async () => {
        if (!activeCommentId) return;
        setIsSaving(true);

        const { error } = await supabase
            .from('transactions')
            .update({ comments: null })
            .eq('transaction_id', activeCommentId);

        if (!error) {
            toast.success("Comment deleted successfully");
            setCommentText("");
            setIsCommentOpen(false);
            fetchFinancialData();
        } else {
            console.error("Error deleting comment:", error);
            toast.error("Failed to delete comment");
        }
        setIsSaving(false);
    };

    // Calculate Summary Cards
    const totalReceived = transactions.reduce((sum, t) => t.amount > 0 ? sum + t.amount : sum, 0);
    const totalSpent = transactions.reduce((sum, t) => t.amount < 0 ? sum + Math.abs(t.amount) : sum, 0); // Absolute for "Spent"
    const netCashflow = transactions.reduce((sum, t) => sum + t.amount, 0);

    const clientInvoices = totalReceived;
    const vendorInvoices = totalSpent;
    const profitLoss = netCashflow;

    const totalLaborCost = (costSummary?.labor_cost_inhouse || 0) + (costSummary?.labor_cost_outsourced || 0);
    const totalActualCost = costSummary?.total_actual_cost || 0;
    const profitLossComprehensive = (costSummary?.income_total || 0) - totalActualCost;

    return (
        <div className="space-y-6">
            {/* Integrated Summary - Project Costing + Manpower */}
            <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Calculator className="h-5 w-5 text-blue-600" />
                        Comprehensive Financial Overview
                    </CardTitle>
                    <p className="text-xs text-slate-600">
                        Integrated data from Project Costing, Manpower, and Transactions
                    </p>
                </CardHeader>
                <CardContent>
                    {costLoading ? (
                        <div className="text-center py-4 text-muted-foreground">Loading cost data...</div>
                    ) : costSummary ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                            <Card>
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Package className="h-5 w-5 text-blue-600" />
                                        <div className="text-xs text-slate-600">Material Costs</div>
                                    </div>
                                    <div className="text-xl font-bold text-blue-700">
                                        {formatCurrency(costSummary.material_cost_actual)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">From material movements</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Users className="h-5 w-5 text-purple-600" />
                                        <div className="text-xs text-slate-600">Labor Costs</div>
                                    </div>
                                    <div className="text-xl font-bold text-purple-700">
                                        {formatCurrency(totalLaborCost)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        In-House: {formatCurrency(costSummary.labor_cost_inhouse)}<br/>
                                        Outsourced: {formatCurrency(costSummary.labor_cost_outsourced)}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Wallet className="h-5 w-5 text-orange-600" />
                                        <div className="text-xs text-slate-600">Total Actual Cost</div>
                                    </div>
                                    <div className="text-xl font-bold text-orange-700">
                                        {formatCurrency(totalActualCost)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">All cost sources</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendingUp className="h-5 w-5 text-green-600" />
                                        <div className="text-xs text-slate-600">Net Profit/Loss</div>
                                    </div>
                                    <div className={`text-xl font-bold ${profitLossComprehensive >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                        {profitLossComprehensive >= 0 ? '+' : ''}{formatCurrency(profitLossComprehensive)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">Income - Costs</div>
                                </CardContent>
                            </Card>
                        </div>
                    ) : (
                        <div className="text-center py-4 text-slate-500">No cost data available</div>
                    )}
                    
                    {/* Quick Navigation */}
                    {costSummary && (
                        <div className="mt-4 pt-4 border-t flex flex-wrap gap-2">
                            <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => {
                                    const tab = document.querySelector('[data-value="project-costing"]') as HTMLElement;
                                    tab?.click();
                                }}
                                className="text-xs"
                            >
                                <Calculator className="h-3 w-3 mr-1" />
                                View Detailed Costing
                            </Button>
                            <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => {
                                    const tab = document.querySelector('[data-value="manpower"]') as HTMLElement;
                                    tab?.click();
                                }}
                                className="text-xs"
                            >
                                <Users className="h-3 w-3 mr-1" />
                                View Manpower & Payments
                            </Button>
                            <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => {
                                    const tab = document.querySelector('[data-value="material-movements"]') as HTMLElement;
                                    tab?.click();
                                }}
                                className="text-xs"
                            >
                                <Package className="h-3 w-3 mr-1" />
                                View Material Movements
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 3 Financial Summary Cards */}
            <div className="grid gap-6 md:grid-cols-3">
                {/* Card 1: Budget Analysis */}
                <Card className="h-full">
                    <CardContent className="p-0 h-full">
                        <div className="flex flex-row h-full items-center">
                            {/* Left 55% */}
                            <div className="w-[55%] border-r pl-4 py-4 pr-2 flex flex-col justify-center gap-3">
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Quotes Approved</p>
                                        <p className="font-semibold text-sm">{formatCurrency(quotesTotal)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Package className="h-4 w-4 text-blue-600 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Material Costs</p>
                                        <p className="font-semibold text-sm">
                                            {costLoading ? '...' : formatCurrency(costSummary?.material_cost_actual || 0)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Users className="h-4 w-4 text-purple-600 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Manpower costs (total)</p>
                                        <p className="font-semibold text-sm">
                                            {costLoading ? '...' : formatCurrency((costSummary?.labor_cost_inhouse || 0) + (costSummary?.labor_cost_outsourced || 0))}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            {/* Right 45% */}
                            <div className="w-[45%] flex flex-col items-center justify-center p-2 text-center bg-gray-50/50 h-full">
                                <span className="text-sm font-medium text-muted-foreground mb-1">% Margin</span>
                                <span className="text-xl font-bold text-emerald-600">{formatCurrency(quotesTotal - 0)}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Card 2: Invoicing */}
                <Card className="h-full">
                    <CardContent className="p-0 h-full">
                        <div className="flex flex-row h-full items-center">
                            {/* Left 55% */}
                            <div className="w-[55%] border-r pl-4 py-4 pr-2 flex flex-col justify-center gap-3">
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Client Invoices</p>
                                        <p className="font-semibold text-sm">{formatCurrency(clientInvoices)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Vendor Invoices</p>
                                        <p className="font-semibold text-sm">{formatCurrency(vendorInvoices)}</p>
                                    </div>
                                </div>
                            </div>
                            {/* Right 45% */}
                            <div className="w-[45%] flex flex-col items-center justify-center p-2 text-center bg-gray-50/50 h-full">
                                <span className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3" /> Profit/Loss
                                </span>
                                <span className={cn("text-xl font-bold flex items-center gap-1", profitLoss >= 0 ? "text-emerald-600" : "text-red-500")}>
                                    {profitLoss >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(profitLoss))}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Card 3: Cashflow */}
                <Card className="h-full">
                    <CardContent className="p-0 h-full">
                        <div className="flex flex-row h-full items-center">
                            {/* Left 55% */}
                            <div className="w-[55%] border-r pl-4 py-4 pr-2 flex flex-col justify-center gap-3">
                                <div className="flex items-start gap-2">
                                    <ArrowUpRight className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Payment Received</p>
                                        <p className="font-semibold text-sm">{formatCurrency(totalReceived)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <ArrowDownLeft className="h-4 w-4 text-red-500 mt-1 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Payment Done</p>
                                        <p className="font-semibold text-sm">{formatCurrency(totalSpent)}</p>
                                    </div>
                                </div>
                            </div>
                            {/* Right 45% */}
                            <div className="w-[45%] flex flex-col items-center justify-center p-2 text-center bg-gray-50/50 h-full">
                                <span className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
                                    <Wallet className="h-3 w-3" /> Cashflow
                                </span>
                                <span className={cn("text-xl font-bold", netCashflow >= 0 ? "text-emerald-600" : "text-red-500")}>
                                    {formatCurrency(netCashflow)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Transactions Table */}
            <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">Transactions</CardTitle>
                    <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
                        <DialogTrigger asChild>
                            <Button onClick={() => { setCurrentTransactionId(null); setNewPayment({ vendor_name: '', amount: '', description: '', type: 'Debit', category: 'VendorPayment', receipt_url: '' }); setReceiptFile(null); }} className="bg-blue-600 text-white hover:bg-blue-700 h-8 gap-1">
                                <Plus className="h-4 w-4" /> Payment
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-white text-slate-900 border shadow-lg sm:max-w-[500px]">
                            <DialogHeader>
                                <DialogTitle>{currentTransactionId ? 'Edit Payment' : 'Add New Payment'}</DialogTitle>
                                <DialogDescription>
                                    {currentTransactionId ? 'Update the details of this transaction.' : 'Manually record a transaction for this project.'}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                                    <Label htmlFor="vendor" className="text-right text-slate-700">Vendor</Label>
                                    <Input id="vendor" value={newPayment.vendor_name} onChange={(e) => setNewPayment({ ...newPayment, vendor_name: e.target.value })} className="col-span-3 bg-white text-slate-900 border-slate-300" />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                                    <Label htmlFor="description" className="text-right text-slate-700">Desc</Label>
                                    <Input id="description" value={newPayment.description} onChange={(e) => setNewPayment({ ...newPayment, description: e.target.value })} className="col-span-3 bg-white text-slate-900 border-slate-300" />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                                    <Label htmlFor="amount" className="text-right text-slate-700">Amount</Label>
                                    <Input id="amount" type="number" value={newPayment.amount} onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })} className="col-span-3 bg-white text-slate-900 border-slate-300" />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                                    <Label htmlFor="type" className="text-right text-slate-700">Type</Label>
                                    <div className="col-span-3">
                                        <Select value={newPayment.type} onValueChange={(val: string) => setNewPayment({ ...newPayment, type: val })}>
                                            <SelectTrigger className="bg-white text-slate-900 border-slate-300"><SelectValue placeholder="Select type" /></SelectTrigger>
                                            <SelectContent className="bg-white border border-slate-200 shadow-xl z-[9999]">
                                                <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="Debit">Debit (Expense)</SelectItem>
                                                <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="Credit">Credit (Income)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                                    <Label htmlFor="category" className="text-right text-slate-700">Category</Label>
                                    <div className="col-span-3">
                                        <Select value={newPayment.category} onValueChange={(val: string) => setNewPayment({ ...newPayment, category: val })}>
                                            <SelectTrigger className="bg-white text-slate-900 border-slate-300"><SelectValue placeholder="Select category" /></SelectTrigger>
                                            <SelectContent className="bg-white border border-slate-200 shadow-xl z-[9999]">
                                                <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="VendorPayment">Vendor Payment</SelectItem>
                                                <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="ClientPayment">Client Payment</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                                    <Label htmlFor="receipt" className="text-right text-slate-700">Receipt</Label>
                                    <div className="col-span-3">
                                        <Input
                                            id="receipt"
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => setReceiptFile(e.target.files ? e.target.files[0] : null)}
                                            className="bg-white text-slate-900 border-slate-300"
                                        />
                                        {newPayment.receipt_url && !receiptFile && (
                                            <p className="text-xs text-green-600 mt-1">✓ Current receipt attached</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="submit" onClick={handlePayment} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                                    {isSaving ? 'Saving...' : (currentTransactionId ? 'Update Payment' : 'Save Payment')}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Comment Dialog */}
                    <Dialog open={isCommentOpen} onOpenChange={setIsCommentOpen}>
                        <DialogContent className="bg-white text-slate-900 border shadow-lg sm:max-w-[400px]">
                            <DialogHeader>
                                <DialogTitle>Transaction Comment</DialogTitle>
                                <DialogDescription>Add or update notes for this transaction.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid w-full gap-1.5">
                                    <Label htmlFor="comment">Comment</Label>
                                    <textarea id="comment" className="flex min-h-[80px] w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50" placeholder="Type your comment here..." value={commentText} onChange={(e) => setCommentText(e.target.value)} />
                                </div>
                            </div>
                            <DialogFooter className="flex justify-between sm:justify-between w-full">
                                {commentText ? (<Button type="button" onClick={handleDeleteComment} disabled={isSaving} className="bg-red-600 text-white hover:bg-red-700">Delete</Button>) : <span></span>}
                                <Button type="submit" onClick={handleSaveComment} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700 ml-auto">{isSaving ? 'Saving...' : 'Save Comment'}</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* View Details Dialog */}
                    <Dialog open={!!viewTransaction} onOpenChange={(open: boolean) => !open && setViewTransaction(null)}>
                        <DialogContent className="bg-white text-slate-900 border shadow-lg sm:max-w-[500px]">
                            <DialogHeader>
                                <DialogTitle>Transaction Details</DialogTitle>
                                <DialogDescription>Full details for this transaction.</DialogDescription>
                            </DialogHeader>
                            {viewTransaction && (
                                <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">ID</Label><div className="col-span-3 text-sm">{viewTransaction.transaction_id}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Date</Label><div className="col-span-3 text-sm">{formatDate(viewTransaction.transaction_date)}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Vendor</Label><div className="col-span-3 text-sm">{viewTransaction.vendor_name}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Description</Label><div className="col-span-3 text-sm">{viewTransaction.description}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Amount</Label><div className={cn("col-span-3 text-sm font-bold", viewTransaction.amount > 0 ? 'text-green-600' : 'text-red-600')}>{formatCurrency(viewTransaction.amount)}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Type</Label><div className="col-span-3 text-sm">{viewTransaction.type} ({viewTransaction.amount < 0 ? 'Debit' : 'Credit'})</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Category</Label><div className="col-span-3 text-sm">{viewTransaction.category}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Channel</Label><div className="col-span-3 text-sm">{viewTransaction.payment_channel}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Created By</Label><div className="col-span-3 text-sm">{viewTransaction.created_by_name}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Order Ref</Label><div className="col-span-3 text-sm text-blue-600">{viewTransaction.order_reference}</div></div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4"><Label className="text-right font-bold text-slate-700">Comments</Label><div className="col-span-3 text-sm italic text-gray-600">{viewTransaction.comments || "No comments"}</div></div>
                                    {viewTransaction.receipt_url && viewTransaction.receipt_url !== 'true' && (
                                        <div className="grid grid-cols-1 sm:grid-cols-4 items-start gap-2 sm:gap-4">
                                            <Label className="text-right font-bold text-slate-700">Receipt</Label>
                                            <div className="col-span-3 text-sm">
                                                <a href={viewTransaction.receipt_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                                                    <ImageIcon className="h-4 w-4" /> View Receipt
                                                </a>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <DialogFooter><Button onClick={() => setViewTransaction(null)} className="bg-gray-200 text-gray-800 hover:bg-gray-300">Close</Button></DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    <Table className="min-w-[900px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[80px]">Date</TableHead>
                                <TableHead className="min-w-[100px]">Vendor</TableHead>
                                <TableHead className="min-w-[120px]">Transaction</TableHead>
                                <TableHead className="w-[90px]">Channel</TableHead>
                                <TableHead className="w-[100px] text-right">Amount</TableHead>
                                <TableHead className="w-[50px] text-center">Receipt</TableHead>
                                <TableHead className="w-[50px] text-center">Details</TableHead>
                                <TableHead className="w-[50px] text-center">Notes</TableHead>
                                <TableHead className={`w-[80px] text-center ${STICKY_ACTION_CELL_CLASS}`}>Actions</TableHead>
                            </TableRow>
                            {/* Filter Row */}
                            <TableRow className="bg-gray-50 hover:bg-gray-50">
                                <TableHead className="p-1">
                                    <Input
                                        type="date"
                                        className="h-8 text-xs bg-white"
                                        value={txFilters.transactionDate}
                                        onChange={(e) => handleTxFilterChange('transactionDate', e.target.value)}
                                    />
                                </TableHead>
                                <TableHead className="p-1">
                                    <Input
                                        className="h-8 text-xs bg-white"
                                        placeholder="Search..."
                                        value={txFilters.vendor}
                                        onChange={(e) => handleTxFilterChange('vendor', e.target.value)}
                                    />
                                </TableHead>
                                <TableHead className="p-1">
                                    <Input
                                        className="h-8 text-xs bg-white"
                                        placeholder="Search..."
                                        value={txFilters.description}
                                        onChange={(e) => handleTxFilterChange('description', e.target.value)}
                                    />
                                </TableHead>
                                <TableHead className="p-1">
                                    <Input
                                        className="h-8 text-xs bg-white"
                                        placeholder="Search..."
                                        value={txFilters.channel}
                                        onChange={(e) => handleTxFilterChange('channel', e.target.value)}
                                    />
                                </TableHead>
                                <TableHead className="p-1" colSpan={5}>
                                    <div className="h-8" />
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8">Loading Transactions...</TableCell>
                                </TableRow>
                            ) : transactions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8">No transactions found.</TableCell>
                                </TableRow>
                            ) : filteredTransactions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8">No matching transactions.</TableCell>
                                </TableRow>
                            ) : (
                                sortedTransactions.map((t) => (
                                    <TableRow key={t.transaction_id} className="hover:bg-gray-50">
                                        <TableCell className="py-2 text-xs text-muted-foreground">{formatDate(t.transaction_date)}</TableCell>
                                        <TableCell className="py-2 text-sm font-medium">{t.vendor_name}</TableCell>
                                        <TableCell className="py-2 text-xs">{t.description}</TableCell>
                                        <TableCell className="py-2 text-xs">{t.payment_channel}</TableCell>
                                        <TableCell className={cn("py-2 text-right text-sm font-bold", t.amount > 0 ? 'text-green-600' : 'text-red-500')}>
                                            {formatCurrency(t.amount)}
                                        </TableCell>
                                        <TableCell className="py-2 text-center">
                                            {t.receipt_url && t.receipt_url !== 'true' ? (
                                                <a href={t.receipt_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                                                    <ImageIcon className="h-4 w-4 inline" />
                                                </a>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="py-2 text-center">
                                            <ExternalLink className="h-4 w-4 text-blue-500 cursor-pointer hover:text-blue-700 inline" onClick={() => setViewTransaction(t)} />
                                        </TableCell>
                                        <TableCell className="py-2 text-center">
                                            <MessageSquare className={cn("h-4 w-4 cursor-pointer hover:scale-110 transition-transform inline", t.comments ? "text-blue-600 fill-blue-100" : "text-gray-400")} onClick={() => openCommentDialog(t)} />
                                        </TableCell>
                                        <TableCell className={`py-2 text-center ${STICKY_ACTION_CELL_CLASS}`}>
                                            <div className="flex items-center justify-center gap-1">
                                                <Button variant="ghost" size="sm" onClick={() => handleEditTransaction(t)} className="h-7 w-7 p-0">
                                                    <Pencil className="h-3 w-3 text-blue-600" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteTransaction(t.transaction_id)} className="h-7 w-7 p-0">
                                                    <Trash className="h-3 w-3 text-red-600" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div >
    );
}
