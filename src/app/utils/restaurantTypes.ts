/**
 * Tipos compartidos del flujo de pedidos de restaurante.
 *
 * Este módulo no depende de React ni del backend: es el contrato que usan el
 * repositorio local (fase 1) y una futura implementación remota (fase 2).
 */

export type PedidoEstado = 'pendiente' | 'en_preparacion' | 'finalizado' | 'entregado' | 'cancelado';

export type EmpleadoRol = 'mesero' | 'cocina' | 'admin';

export interface EmpleadoRef {
  id: string;
  nombre: string;
  rol: EmpleadoRol;
}

export interface PedidoItem {
  /** Identificador de la línea, no del producto. */
  id: string;
  productId: string;
  nombre: string;
  precioUnitario: number;
  cantidad: number;
  nota?: string;
  /** Los productos de venta directa no aparecen en cocina. */
  ventaDirecta: boolean;
}

export interface Pedido {
  source?: 'shared' | 'legacy';
  id: string;
  negocioId: string;
  numero: number;
  /** Clave de la jornada calculada con la hora de inicio configurada. */
  jornada: string;
  estado: PedidoEstado;
  canal: 'local';
  mesaId: string;
  mesaNumero: number;
  mesaNombre: string;
  meseroId: string;
  meseroNombre: string;
  items: PedidoItem[];
  subtotal: number;
  impuesto: number;
  taxRate: number;
  total: number;
  nota?: string;
  creadoEn: string;
  actualizadoEn: string;
  tomadoPorId?: string;
  tomadoPorNombre?: string;
  tomadoEn?: string;
  finalizadoPorId?: string;
  finalizadoPorNombre?: string;
  finalizadoEn?: string;
  entregadoPorId?: string;
  entregadoPorNombre?: string;
  entregadoEn?: string;
  canceladoPorId?: string;
  canceladoPorNombre?: string;
  canceladoEn?: string;
  motivoCancelacion?: string;
  /** Venta creada al entregar el pedido. */
  ventaId?: string;
  ventaRegistradaEn?: string;
  /** Pedido compuesto solo por productos de venta directa. */
  listoParaLlevar: boolean;
}

export interface CrearPedidoItemInput {
  productId: string;
  nombre: string;
  precioUnitario: number;
  cantidad: number;
  nota?: string;
  ventaDirecta: boolean;
}

export interface CrearPedidoInput {
  negocioId: string;
  mesaId: string;
  mesaNumero: number;
  mesaNombre: string;
  mesero: EmpleadoRef;
  items: CrearPedidoItemInput[];
  nota?: string;
  /** Hora local "HH:mm" con la que se calcula la jornada. */
  horaInicioJornada: string;
  /** Impuesto del negocio, por ejemplo 0.19. Se usa para mostrar el total real. */
  taxRate?: number;
}

export interface PedidosRepository {
  listar(negocioId: string): Promise<Pedido[]>;
  suscribirse(negocioId: string, listener: (pedidos: Pedido[]) => void, onError?: (error: unknown) => void): () => void;
  crearPedido(input: CrearPedidoInput): Promise<Pedido>;
  tomarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido>;
  finalizarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido>;
  entregarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, ventaId?: string): Promise<Pedido>;
  cancelarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, motivo: string): Promise<Pedido>;
}

export class PedidoConflictoError extends Error {
  pedido: Pedido;
  constructor(message: string, pedido: Pedido) {
    super(message);
    this.name = 'PedidoConflictoError';
    this.pedido = pedido;
  }
}
