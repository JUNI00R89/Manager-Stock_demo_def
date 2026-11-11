import { Badge } from '../ui/badge';
import type { PedidoEstado } from '../../utils/restaurantTypes';
import { PEDIDO_ESTADO_LABELS } from '../../utils/restaurantPedidosRepository';

const TONES: Record<PedidoEstado, string> = {
  pendiente: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  en_preparacion: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  finalizado: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  entregado: 'border-border bg-muted text-muted-foreground',
  cancelado: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export function PedidoStatusBadge({ estado, className = '' }: { estado: PedidoEstado; className?: string }) {
  return (
    <Badge variant="outline" className={`${TONES[estado]} ${className}`}>
      {PEDIDO_ESTADO_LABELS[estado]}
    </Badge>
  );
}
