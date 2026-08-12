export default function CustomersLoading() {
  return (
    <div aria-label="거래처 정보를 불러오는 중" className="animate-pulse space-y-4">
      <div className="h-9 w-48 rounded-lg bg-slate-200" />
      <div className="h-24 rounded-2xl bg-white" />
      <div className="h-80 rounded-2xl bg-white" />
    </div>
  );
}
