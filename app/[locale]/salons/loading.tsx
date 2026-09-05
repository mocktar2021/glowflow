export default function SalonSearchLoading() {
  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-10 dark:bg-[#101216]" aria-busy="true" aria-label="Loading salons">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-10 w-48 rounded-xl bg-[#eadfd2] dark:bg-white/10" />
        <div className="mt-8 h-48 rounded-[1.75rem] bg-white dark:bg-white/5" />
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-80 rounded-[1.75rem] bg-white dark:bg-white/5" />
          ))}
        </div>
      </div>
    </main>
  );
}
