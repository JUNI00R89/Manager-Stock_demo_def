import type { ElementType, ReactNode } from 'react';
import '../../pages/editorial-page.css';

// Each block carries its own `editorial-page` scope so it can drop into any screen;
// nesting it inside a page that already has the scope changes nothing.

/** Page header in the editorial design: eyebrow, large title, subtitle, actions and a hairline below. */
export function EditorialHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="editorial-page">
      <header className="dash-header">
        <div>
          <p className="dash-eyebrow">{eyebrow}</p>
          <h1 className="dash-title">{title}</h1>
          {subtitle && <p className="dash-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="dash-actions">{actions}</div>}
      </header>
    </div>
  );
}

/** The dark summary block: one large figure plus up to three supporting metrics. */
export function EditorialHero({
  kicker,
  aside,
  label,
  value,
  note,
  metrics,
}: {
  kicker: string;
  aside?: string;
  label: string;
  value: ReactNode;
  note?: string;
  metrics: { label: string; value: ReactNode; note?: string }[];
}) {
  return (
    <div className="editorial-page">
      <section className="dash-hero" aria-label={label}>
        <div className="dash-hero-top">
          <p className="dash-hero-kicker">{kicker}</p>
          {aside && <span className="dash-hero-date">{aside}</span>}
        </div>
        <div className="dash-hero-body">
          <div>
            <p className="dash-hero-label">{label}</p>
            <p className="dash-hero-value">{value}</p>
            {note && <p className="dash-hero-note">{note}</p>}
          </div>
          <div className="dash-hero-metrics">
            {metrics.map(metric => (
              <div key={metric.label} className="dash-hero-metric">
                <p className="dash-hero-metric-label">{metric.label}</p>
                <p className="dash-hero-metric-value">{metric.value}</p>
                {metric.note && <p className="dash-hero-metric-note">{metric.note}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/** A single flat indicator: small uppercase label, figure and hint, with a muted icon. */
export function EditorialStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ElementType;
}) {
  return (
    <div className="editorial-page h-full">
      <section className="dash-panel dash-stat">
        <div className="min-w-0">
          <p className="dash-kicker">{label}</p>
          <p className="dash-stat-value">{value}</p>
          {hint && <p className="dash-stat-hint">{hint}</p>}
        </div>
        {Icon && <Icon className="dash-stat-icon h-4 w-4" />}
      </section>
    </div>
  );
}
