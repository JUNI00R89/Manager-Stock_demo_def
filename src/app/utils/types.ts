// ─── Core business entities (relational model, ready for Supabase) ───────────

export interface Empresa {
  id: string;
  nombre: string;
  plan: 'basic' | 'premium';
}

export interface Sucursal {
  id: string;
  empresaId: string;
  nombre: string;
  direccion: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  minStock: number;
  description: string;
  image: string;
  cost?: number;
  productType?: 'sale_item' | 'ingredient' | 'supplies';
  unit?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  barcode?: string;
  trackLots?: boolean;
  defaultLocationId?: string | null;
  variantesIds?: string[];
  codigosBarras?: string[];
}

export interface Variante {
  id: string;
  productoId: string;
  nombre: string;
  sku: string;
  precio?: number;
  stock: number;
}

export interface CodigoBarras {
  id: string;
  productoId: string;
  varianteId?: string;
  codigo: string;
  tipo: 'EAN13' | 'CODE128' | 'QR';
  principal: boolean;
}

export interface StockPorBodega {
  productoId: string;
  varianteId?: string;
  sucursalId: string;
  loteId?: string;
  cantidad: number;
}

export interface Lote {
  id: string;
  productoId: string;
  numero: string;
  fechaVencimiento?: string;
  cantidad: number;
  sucursalId: string;
}

export interface Traslado {
  id: string;
  origen: string;
  destino: string;
  estado: 'pendiente' | 'en_transito' | 'recibido';
  items: { productoId: string; nombre: string; cantidad: number }[];
  fechaCreacion: string;
  fechaEnvio?: string;
  fechaRecepcion?: string;
  notas?: string;
}

export interface PedidoCompra {
  id: string;
  proveedorId: string;
  proveedorNombre: string;
  estado: 'pendiente' | 'aprobado' | 'entregado';
  items: { productoId: string; nombre: string; cantidad: number; precioUnitario: number }[];
  fechaCreacion: string;
  fechaEntrega?: string;
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  totalPrice: number;
  date: string;
  status: 'completed' | 'pending' | 'cancelled';
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  products: string[];
  notes: string;
}

// ─── Restaurant ──────────────────────────────────────────────────────────────

export interface Mesa {
  id: string;
  numero: number;
  zona: string;
  capacidad: number;
  estado: 'libre' | 'ocupada' | 'por_cobrar' | 'reservada';
}

export interface ItemComanda {
  id: string;
  productoId: string;
  nombre: string;
  cantidad: number;
  precio: number;
  notas?: string;
  estado: 'nuevo' | 'en_preparacion' | 'listo' | 'entregado';
  estacion?: 'cocina' | 'barra' | 'panaderia';
  tiempo?: number; // minutos desde envío
}

export interface Comanda {
  id: string;
  mesaId: string;
  mesaNumero: number;
  estado: 'abierta' | 'en_cocina' | 'lista' | 'cobrada';
  items: ItemComanda[];
  mesero: string;
  fechaApertura: string;
  fechaEnvioCocina?: string;
  propina?: number;
}

export interface ReservaRestaurante {
  id: string;
  mesaId: string;
  nombre: string;
  personas: number;
  fecha: string;
  hora: string;
  telefono: string;
  notas?: string;
}

// ─── Hotel ───────────────────────────────────────────────────────────────────

export interface Habitacion {
  id: string;
  numero: string;
  tipo: 'simple' | 'doble' | 'suite' | 'familiar';
  piso: number;
  estado: 'disponible' | 'ocupada' | 'reservada' | 'mantenimiento' | 'limpieza';
  estadoLimpieza: 'sucia' | 'en_limpieza' | 'lista' | 'inspeccionada';
  precio: number;
  capacidad: number;
  amenidades: string[];
}

export interface ReservaHotel {
  id: string;
  habitacionId: string;
  huesped: string;
  email: string;
  telefono: string;
  checkIn: string;
  checkOut: string;
  estado: 'confirmada' | 'checkin' | 'checkout' | 'cancelada';
  anticipo?: number;
  totalCargos: number;
  noches: number;
  notas?: string;
}

export interface CargoHabitacion {
  id: string;
  reservaId: string;
  concepto: string;
  monto: number;
  fecha: string;
}

// ─── Services / Citas ────────────────────────────────────────────────────────

export interface Servicio {
  id: string;
  nombre: string;
  duracion: number;
  precio: number;
  categoria: string;
  color: string;
}

export interface Profesional {
  id: string;
  nombre: string;
  especialidad: string;
  color: string;
  horario: { dia: number; inicio: string; fin: string }[];
}

export interface Cita {
  id: string;
  clienteId: string;
  clienteNombre: string;
  clienteTelefono?: string;
  clienteEmail?: string;
  servicioId: string;
  servicioNombre: string;
  profesionalId: string;
  profesionalNombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: 'reservada' | 'confirmada' | 'atendida' | 'cancelada' | 'no_asistio';
  notas?: string;
  saleId?: string | null;
}

export interface Cliente {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  citasIds: string[];
}

// ─── Users & Roles ───────────────────────────────────────────────────────────

export type RolUsuario = 'administrador' | 'propietario' | 'cajero' | 'mesero' | 'recepcionista' | 'profesional' | 'soporte';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  sucursalId?: string;
  activo: boolean;
  ultimoAcceso?: string;
  avatar?: string;
}

export interface RegistroActividad {
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  modulo: string;
  accion: string;
  fecha: string;
  detalle?: string;
}
