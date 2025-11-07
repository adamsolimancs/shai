export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <section className="mx-auto mt-16 w-full max-w-3xl rounded-[32px] border border-white/10 bg-slate-950/70 p-10 shadow-2xl shadow-black/30 backdrop-blur">
      {children}
    </section>
  );
}
