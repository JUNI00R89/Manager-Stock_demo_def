import {
  ArrowRight,
  Boxes,
  ChartNoAxesCombined,
  Check,
  ClipboardList,
  Download,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Store,
  Hotel,
  UtensilsCrossed,
  Scissors,
  Warehouse,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSubscriptionPlans, type SubscriptionPlanRecord } from '../services/dataService';
import { Link } from 'react-router';

const features = [
  {
    icon: PackageCheck,
    title: 'Inventario organizado',
    text: 'Consulta productos, existencias, alertas de stock y movimientos desde una sola interfaz.',
  },
  {
    icon: ShoppingCart,
    title: 'Ventas y caja',
    text: 'Registra operaciones, consulta el historial y mantén trazabilidad de las ventas.',
  },
  {
    icon: ShieldCheck,
    title: 'Usuarios y permisos',
    text: 'Define los accesos según las responsabilidades de cada persona en el negocio.',
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Indicadores y reportes',
    text: 'Revisa la información disponible para entender la operación y tomar decisiones.',
  },
];
const businessTypes = [
  { icon: Store, title: 'Tiendas y comercios', text: 'Productos, proveedores, ventas e inventario.' },
  { icon: UtensilsCrossed, title: 'Negocios de comidas', text: 'Menú, pedidos, ventas y productos individuales.' },
  {
    icon: Hotel,
    title: 'Hoteles y alojamientos',
    text: 'Módulos de habitaciones y reservas cuando estén habilitados.',
  },
  { icon: Scissors, title: 'Servicios y citas', text: 'Organización de servicios y agendas según la configuración.' },
  {
    icon: Warehouse,
    title: 'Bodegas y distribuidoras',
    text: 'Organización de productos y movimientos de inventario.',
  },
];

export function LandingPage() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [publicPlans, setPublicPlans] = useState<SubscriptionPlanRecord[]>([]);
  useEffect(() => {
    let active = true;
    getSubscriptionPlans()
      .then(rows => {
        if (active) setPublicPlans(rows);
      })
      .catch(() => {
        if (active) setPublicPlans([]);
      });
    return () => {
      active = false;
    };
  }, []);
  const slides = [
    {
      title: 'Inventario bajo control',
      description: 'Consulta productos, existencias y alertas de stock desde una vista organizada.',
      icon: PackageCheck,
      eyebrow: 'Inventario',
    },
    {
      title: 'Operaciones más claras',
      description: 'Conecta ventas, clientes y procesos cotidianos según los módulos de tu negocio.',
      icon: ShoppingCart,
      eyebrow: 'Operación comercial',
    },
    {
      title: 'Una agenda para tu equipo',
      description: 'Organiza servicios y citas con una experiencia enfocada en la agenda de cada negocio.',
      icon: Scissors,
      eyebrow: 'Servicios y citas',
    },
  ];
  const slide = slides[activeSlide];
  const SlideIcon = slide.icon;
  const changeSlide = (direction: number) =>
    setActiveSlide(current => (current + direction + slides.length) % slides.length);
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--brand-background)] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#inicio" className="flex items-center gap-3" aria-label="MANAGER STOCK, inicio">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-white shadow-sm">
              <Boxes size={22} />
            </span>
            <span>
              <strong className="block text-sm font-bold tracking-wide">MANAGER STOCK</strong>
              <small className="block text-xs text-slate-500">Gestión que acompaña tu negocio</small>
            </span>
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex">
            <a href="#funcionalidades" className="hover:text-[var(--brand-primary)]">
              Funcionalidades
            </a>
            <a href="#negocios" className="hover:text-[var(--brand-primary)]">
              Tipos de negocio
            </a>
            <a href="#planes" className="hover:text-[var(--brand-primary)]">
              Planes
            </a>
            <a href="#preguntas" className="hover:text-[var(--brand-primary)]">
              Preguntas frecuentes
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:inline-flex"
            >
              Iniciar sesión
            </Link>
            <Link
              to="/descargas"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            >
              Descargas <Download size={16} />
            </Link>
          </div>
        </div>
      </header>

      <section id="inicio" className="relative isolate">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(120,152,137,.22),transparent_42%),linear-gradient(140deg,#f7fafb_0%,#eef4f4_48%,#f9fafb_100%)]"
        />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-[var(--brand-primary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--brand-secondary)]" />
              Una plataforma para diferentes negocios
            </span>
            <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Todo tu negocio, más <span className="text-[var(--brand-primary)]">organizado.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              MANAGER STOCK reúne herramientas para gestionar inventario, ventas y operaciones cotidianas, con módulos
              adaptados a las necesidades de cada negocio.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#funcionalidades"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 py-3.5 text-sm font-semibold text-white shadow-md transition hover:brightness-95"
              >
                Conocer funcionalidades <ArrowRight size={17} />
              </a>
              <Link
                to="/descargas"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <Download size={17} /> Ver descargas
              </Link>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Consulta la disponibilidad real de cada versión en el centro de descargas.
            </p>
          </div>
          <div className="relative mx-auto w-full max-w-xl">
            <div
              aria-hidden="true"
              className="absolute -inset-6 rounded-[2rem] bg-[var(--brand-primary)]/10 blur-2xl"
            />
            <div className="relative rounded-[1.7rem] border border-white bg-white p-4 shadow-2xl shadow-slate-900/10 sm:p-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
                <span className="text-xs font-medium text-slate-400">Vista de ejemplo</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <span className="text-xs font-medium text-slate-500">Inventario</span>
                  <div className="mt-3 flex items-end justify-between">
                    <strong className="text-2xl text-slate-900">Controlado</strong>
                    <PackageCheck className="text-[var(--brand-primary)]" size={22} />
                  </div>
                  <div className="mt-4 h-1.5 rounded-full bg-slate-200">
                    <div className="h-1.5 w-4/5 rounded-full bg-[var(--brand-secondary)]" />
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <span className="text-xs font-medium text-slate-500">Operaciones</span>
                  <div className="mt-3 flex items-end justify-between">
                    <strong className="text-2xl text-slate-900">Unificadas</strong>
                    <ClipboardList className="text-[var(--brand-primary)]" size={22} />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Información en un solo lugar</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-100 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Procesos más claros</p>
                    <p className="mt-1 text-xs text-slate-500">Una interfaz adaptada a tu actividad</p>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]">
                    <ChartNoAxesCombined size={20} />
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {['Productos e inventario', 'Ventas y seguimiento', 'Usuarios y permisos'].map(item => (
                    <div key={item} className="flex items-center gap-3 text-sm text-slate-600">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                        <Check size={12} />
                      </span>
                      {item}
                      <span className="ml-auto h-1.5 w-14 rounded-full bg-slate-100" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Funciones destacadas de MANAGER STOCK"
        className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 sm:pb-14"
      >
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-6 text-white shadow-xl sm:p-10">
          <div
            className="absolute -right-12 -top-16 h-64 w-64 rounded-full bg-teal-400/10 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative grid items-center gap-8 md:grid-cols-[.9fr_1.1fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.2em] text-teal-200">Explora la plataforma</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">Herramientas para trabajar con más claridad.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                Conoce algunas de las áreas que puedes organizar con MANAGER STOCK. Las opciones dependen de la
                configuración y de los permisos de cada cuenta.
              </p>
              <div className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Mostrar función anterior"
                  onClick={() => changeSlide(-1)}
                  className="rounded-xl border border-white/20 p-3 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Mostrar función siguiente"
                  onClick={() => changeSlide(1)}
                  className="rounded-xl border border-white/20 p-3 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                >
                  <ChevronRight size={18} />
                </button>
                <div className="ml-2 flex gap-2" role="group" aria-label="Seleccionar diapositiva">
                  {slides.map((item, index) => (
                    <button
                      key={item.eyebrow}
                      type="button"
                      aria-label={`Mostrar ${item.eyebrow}`}
                      aria-pressed={activeSlide === index}
                      onClick={() => setActiveSlide(index)}
                      className={`h-2.5 rounded-full transition-all ${activeSlide === index ? 'w-8 bg-teal-300' : 'w-2.5 bg-white/35 hover:bg-white/60'}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div
              key={slide.eyebrow}
              className="animate-[fade-in_.35s_ease-out] rounded-3xl border border-white/10 bg-white/[.06] p-6 backdrop-blur-sm sm:p-8"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex rounded-full border border-teal-200/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold text-teal-100">
                    {slide.eyebrow}
                  </span>
                  <h3 className="mt-5 text-2xl font-semibold sm:text-3xl">{slide.title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{slide.description}</p>
                </div>
                <span className="rounded-2xl bg-teal-300/10 p-4 text-teal-200">
                  <SlideIcon size={30} />
                </span>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-3" aria-hidden="true">
                <div className="h-2 rounded-full bg-teal-300/70" />
                <div className="h-2 rounded-full bg-white/20" />
                <div className="h-2 rounded-full bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="funcionalidades" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--brand-primary)]">Funcionalidades</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Las herramientas esenciales, conectadas.
          </h2>
          <p className="mt-4 leading-7 text-slate-600">
            El alcance depende del tipo de negocio, de los módulos habilitados y de los permisos de cada usuario.
          </p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]">
                <Icon size={21} />
              </span>
              <h3 className="mt-5 font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="negocios" className="border-y border-slate-200/80 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--brand-primary)]">
              Adaptable por actividad
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Cada negocio tiene su propia operación.
            </h2>
            <p className="mt-4 leading-7 text-slate-600">
              La plataforma permite organizar los módulos según la actividad y mantener los datos de cada empresa
              separados.
            </p>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {businessTypes.map(({ icon: Icon, title, text }) => (
              <article key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--brand-primary)] shadow-sm">
                  <Icon size={21} />
                </span>
                <div>
                  <h3 className="font-semibold text-slate-900">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--brand-primary)]">Planes</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Un plan para cada etapa.
          </h2>
          <p className="mt-4 leading-7 text-slate-600">
            Precios iniciales en COP. La selección de planes de pago requiere que se habilite y confirme un proveedor de
            pagos; esta página no realiza cobros.
          </p>
        </div>
        {publicPlans.length ? (
          <div className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {publicPlans.map((plan, index) => (
              <article
                key={plan.id}
                className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${index === 2 ? 'border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]/20' : 'border-slate-200'}`}
              >
                <p className="text-sm font-semibold text-slate-600">{plan.name}</p>
                <p className="mt-4 text-3xl font-bold text-slate-950">
                  {new Intl.NumberFormat('es-CO', {
                    style: 'currency',
                    currency: 'COP',
                    maximumFractionDigits: 0,
                  }).format(plan.priceCOP)}
                  <span className="text-xs font-medium text-slate-500"> / mes</span>
                </p>
                <ul className="mt-5 flex-1 space-y-3 text-sm text-slate-600">
                  <li className="flex gap-2">
                    <Check size={16} className="shrink-0 text-emerald-600" />
                    Hasta {plan.maxProducts.toLocaleString('es-CO')} productos activos
                  </li>
                  <li className="flex gap-2">
                    <Check size={16} className="shrink-0 text-emerald-600" />
                    Hasta {plan.maxUsers} usuarios incluyendo propietario
                  </li>
                  <li className="flex gap-2">
                    <Check size={16} className="shrink-0 text-emerald-600" />
                    Módulos según tipo de negocio y permisos
                  </li>
                </ul>
                <Link
                  to="/login"
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
                >
                  Consultar plan <ArrowRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-8 max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            Los planes se cargarán cuando el backend esté disponible.
          </div>
        )}
      </section>

      <section id="preguntas" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-20">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--brand-primary)]">
            Preguntas frecuentes
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Lo esencial antes de empezar.</h2>
          <div className="mt-7 divide-y divide-slate-200">
            {[
              {
                q: '¿Qué es MANAGER STOCK?',
                a: 'Es una plataforma en desarrollo para centralizar tareas de inventario, ventas y operación comercial según los módulos disponibles.',
              },
              {
                q: '¿Todos los negocios ven las mismas opciones?',
                a: 'No. La navegación se adapta al tipo de negocio, a los módulos configurados y a los permisos de cada usuario.',
              },
              {
                q: '¿Puedo descargar ahora la aplicación para Windows?',
                a: 'El instalador todavía está en preparación. Por ahora, el botón de descarga conduce a la pantalla de inicio de sesión.',
              },
              {
                q: '¿Los planes ya tienen precios definidos?',
                a: 'Los planes y sus condiciones finales están en preparación. En esta página no se publican precios sin confirmar.',
              },
            ].map(item => (
              <details key={item.q} className="group py-5">
                <summary className="cursor-pointer list-none font-semibold text-slate-900 marker:hidden">
                  {item.q}
                  <span className="float-right ml-4 text-[var(--brand-primary)] transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 text-slate-300">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-9 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
              <Boxes size={21} />
            </span>
            <div>
              <p className="font-semibold text-white">MANAGER STOCK</p>
              <p className="mt-1 text-xs text-slate-400">Gestión organizada para cada negocio.</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <a href="#funcionalidades" className="hover:text-white">
              Funcionalidades
            </a>
            <a href="#negocios" className="hover:text-white">
              Negocios
            </a>
            <a href="#planes" className="hover:text-white">
              Planes
            </a>
            <Link to="/descargas" className="hover:text-white">
              Descargas
            </Link>
            <Link to="/login" className="hover:text-white">
              Iniciar sesión
            </Link>
          </nav>
          <p className="text-xs text-slate-500">Plataforma en desarrollo.</p>
        </div>
      </footer>
    </main>
  );
}
