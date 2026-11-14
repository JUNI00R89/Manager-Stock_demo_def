import { Link } from 'react-router';
import { ArrowLeft, Download, Monitor, Smartphone, Apple, Laptop, Globe, CheckCircle2, Clock3 } from 'lucide-react';

const platforms = [
  {
    name: 'Windows',
    format: 'Instalador .exe o .msi',
    icon: Monitor,
    status: 'Próximamente',
    detail: 'El instalador de escritorio todavía no se ha generado ni firmado.',
  },
  {
    name: 'Android',
    format: 'APK firmado / Google Play',
    icon: Smartphone,
    status: 'No disponible',
    detail: 'No se ha verificado un paquete Android listo para distribuir.',
  },
  {
    name: 'iOS',
    format: 'App Store / TestFlight',
    icon: Apple,
    status: 'No disponible',
    detail: 'La publicación requiere una compilación iOS, certificados y distribución autorizada.',
  },
  {
    name: 'Linux',
    format: 'AppImage / DEB',
    icon: Laptop,
    status: 'Próximamente',
    detail: 'Todavía no hay paquetes Linux construidos y probados.',
  },
];

export function Downloads() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_right,rgba(20,112,110,.14),transparent_42%),linear-gradient(140deg,#f8fafc,#edf4f4)] px-4 py-8 text-slate-900 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft size={16} />
          Volver a MANAGER STOCK
        </Link>
        <header className="mt-8 max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-teal-700/15 bg-white/80 px-3 py-1.5 text-xs font-semibold text-teal-800">
            <Download size={14} />
            Centro oficial de descargas
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">MANAGER STOCK en tus dispositivos.</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Consulta el estado de las versiones por plataforma. No publicamos enlaces de instalación hasta que cada
            paquete exista y haya sido verificado.
          </p>
        </header>
        <section className="mt-9 grid gap-4 sm:grid-cols-2">
          {platforms.map(platform => {
            const Icon = platform.icon;
            const available = false;
            return (
              <article
                key={platform.name}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-2xl bg-teal-50 p-3 text-teal-800">
                    <Icon size={24} />
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${available ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                  >
                    {available ? <CheckCircle2 size={13} /> : <Clock3 size={13} />} {platform.status}
                  </span>
                </div>
                <h2 className="mt-4 text-xl font-bold">{platform.name}</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">{platform.format}</p>
                <p className="mt-3 min-h-12 text-sm leading-6 text-slate-600">{platform.detail}</p>
                <ButtonPlaceholder available={available} />
              </article>
            );
          })}
        </section>
        <section className="mt-6 rounded-2xl border border-teal-900/10 bg-slate-950 p-6 text-white sm:p-8">
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-white/10 p-3 text-teal-200">
              <Globe size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold">Accede a la plataforma web</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Mientras se preparan los instaladores, puedes entrar a la versión web cuando el backend y el frontend
                estén desplegados y disponibles.
              </p>
              <Link
                to="/login"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-200"
              >
                Abrir inicio de sesión <ArrowLeft size={15} className="rotate-180" />
              </Link>
            </div>
          </div>
        </section>
        <p className="mt-6 text-xs leading-5 text-slate-500">
          Estado actual: esta página informa disponibilidad; no se ha afirmado que existan instaladores firmados o
          publicaciones en tiendas de aplicaciones.
        </p>
      </div>
    </main>
  );
}

function ButtonPlaceholder({ available }: { available: boolean }) {
  return (
    <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-sm font-semibold text-slate-500">
      {available ? 'Descarga disponible' : 'Sin archivo de instalación'}
    </p>
  );
}
