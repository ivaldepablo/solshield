export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl">
        <h1 className="text-2xl mb-6">
          <span className="text-accent">sol</span>shield
        </h1>
        <p className="text-fg mb-2">open-source transaction firewall for solana.</p>
        <p className="text-mute text-sm">inspect txs before you sign. wip.</p>
      </div>
    </main>
  );
}
