import TbForm from "@/components/tb/tb-form";
import { tbReconcileAction } from "@/app/actions/tb-reconcile";
import LedgerForm from "@/components/ledger/ledger-form";
import { ledgerReconcileAction } from "@/app/actions/ledger-reconcile";
import { ReconcileTabs } from "@/components/reconcile/reconcile-tabs";

export default function ReconcilePage() {
  return (
    <main className="container mx-auto p-6 font-normal max-w-7xl">
      <ReconcileTabs
        tb={<TbForm onSubmit={tbReconcileAction} />}
        gl={<LedgerForm onSubmit={ledgerReconcileAction} />}
      />
    </main>
  );
}
