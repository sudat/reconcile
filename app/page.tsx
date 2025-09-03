import TbForm from "@/components/tb/tb-form";
import { tbReconcileAction } from "@/app/actions/tb-reconcile";
import LedgerForm from "@/components/ledger/ledger-form";
import { ledgerReconcileAction } from "@/app/actions/ledger-reconcile";

export default function Home() {
  return (
    <main className="container mx-auto p-6 font-normal">
      <TbForm onSubmit={tbReconcileAction} />
      <div className="h-6" />
      <LedgerForm onSubmit={ledgerReconcileAction} />
    </main>
  );
}
