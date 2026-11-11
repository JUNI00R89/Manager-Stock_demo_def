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
