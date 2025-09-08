import TbForm from "@/components/tb/tb-form";
import { tbReconcileAction } from "@/app/actions/tb-reconcile";
import LedgerForm from "@/components/ledger/ledger-form";
import { ledgerReconcileAction } from "@/app/actions/ledger-reconcile";
import { ReconcileTabs } from "@/components/reconcile/reconcile-tabs";

export default function ReconcilePage() {
  return (
    <main className="container mx-auto font-normal max-w-7xl">
      <div className="text-2xl font-bold mb-4  pb-2">照合</div>
      <ReconcileTabs
        tb={<TbForm onSubmit={tbReconcileAction} />}
        gl={<LedgerForm onSubmit={ledgerReconcileAction} />}
      />
    </main>
  );
}
