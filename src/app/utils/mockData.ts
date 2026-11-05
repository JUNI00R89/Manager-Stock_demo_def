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

// ─── Mock data ────────────────────────────────────────────────────────────────

export const mockEmpresas: Empresa[] = [
  { id: 'E1', nombre: 'Grupo Empresarial Demo', plan: 'premium' }
];

export const mockSucursales: Sucursal[] = [
  { id: 'S1', empresaId: 'E1', nombre: 'Sucursal Principal', direccion: 'Av. Central 123' },
  { id: 'S2', empresaId: 'E1', nombre: 'Sucursal Norte', direccion: 'Calle Norte 456' },
  { id: 'S3', empresaId: 'E1', nombre: 'Bodega Central', direccion: 'Parque Industrial 789' },
];

export const mockCodigosBarras: CodigoBarras[] = [
  { id: 'CB1', productoId: '1', codigo: '7501234567890', tipo: 'EAN13', principal: true },
  { id: 'CB2', productoId: '2', codigo: '7509999888771', tipo: 'EAN13', principal: true },
  { id: 'CB3', productoId: '3', codigo: 'KB003-RGB-MECH', tipo: 'CODE128', principal: true },
  { id: 'CB4', productoId: '4', codigo: '7503210987654', tipo: 'EAN13', principal: true },
  { id: 'CB5', productoId: '5', codigo: '4901660148278', tipo: 'EAN13', principal: true },
  { id: 'CB6', productoId: '6', codigo: '5099206062848', tipo: 'EAN13', principal: true },
  { id: 'CB7', productoId: '7', codigo: 'ERG-CHAIR-001', tipo: 'CODE128', principal: true },
  { id: 'CB8', productoId: '8', codigo: '8806090230523', tipo: 'EAN13', principal: true },
];

export const mockProducts: Product[] = [
  {
    id: '1', name: 'Laptop Dell XPS 15', sku: 'LT-001', category: 'Electrónica',
    price: 1299.99, stock: 5, minStock: 10,
    description: 'Laptop de alto rendimiento con procesador Intel i7', image: 'laptop',
    codigosBarras: ['CB1']
  },
  {
    id: '2', name: 'Mouse Logitech MX Master 3', sku: 'MS-002', category: 'Accesorios',
    price: 99.99, stock: 45, minStock: 20,
    description: 'Mouse ergonómico inalámbrico', image: 'mouse',
    codigosBarras: ['CB2']
  },
  {
    id: '3', name: 'Teclado Mecánico RGB', sku: 'KB-003', category: 'Accesorios',
    price: 149.99, stock: 8, minStock: 15,
    description: 'Teclado mecánico con switches Cherry MX', image: 'keyboard',
    codigosBarras: ['CB3']
  },
  {
    id: '4', name: 'Monitor LG 27"', sku: 'MN-004', category: 'Electrónica',
    price: 329.99, stock: 3, minStock: 8,
    description: 'Monitor 4K IPS de 27 pulgadas', image: 'monitor',
    codigosBarras: ['CB4']
  },
  {
    id: '5', name: 'Auriculares Sony WH-1000XM4', sku: 'AU-005', category: 'Audio',
    price: 299.99, stock: 22, minStock: 15,
    description: 'Auriculares inalámbricos con cancelación de ruido', image: 'headphones',
    codigosBarras: ['CB5']
  },
  {
    id: '6', name: 'Webcam Logitech C920', sku: 'WC-006', category: 'Accesorios',
    price: 79.99, stock: 2, minStock: 10,
    description: 'Webcam HD 1080p para videoconferencias', image: 'webcam',
    codigosBarras: ['CB6']
  },
  {
    id: '7', name: 'Silla Gamer ErgoChair', sku: 'CH-007', category: 'Muebles',
    price: 249.99, stock: 18, minStock: 10,
    description: 'Silla ergonómica para gaming y oficina', image: 'chair',
    codigosBarras: ['CB7']
  },
  {
    id: '8', name: 'SSD Samsung 1TB', sku: 'SS-008', category: 'Almacenamiento',
    price: 129.99, stock: 35, minStock: 20,
    description: 'Disco sólido NVMe de alta velocidad', image: 'ssd',
    codigosBarras: ['CB8']
  }
];

export const mockSales: Sale[] = [
  { id: 'S001', productId: '1', productName: 'Laptop Dell XPS 15', quantity: 2, totalPrice: 2599.98, date: '2026-10-07T10:30:00', status: 'completed' },
  { id: 'S002', productId: '2', productName: 'Mouse Logitech MX Master 3', quantity: 5, totalPrice: 499.95, date: '2026-10-07T11:45:00', status: 'completed' },
  { id: 'S003', productId: '5', productName: 'Auriculares Sony WH-1000XM4', quantity: 3, totalPrice: 899.97, date: '2026-10-07T14:20:00', status: 'pending' },
  { id: 'S004', productId: '3', productName: 'Teclado Mecánico RGB', quantity: 1, totalPrice: 149.99, date: '2026-10-06T09:15:00', status: 'completed' },
  { id: 'S005', productId: '4', productName: 'Monitor LG 27"', quantity: 2, totalPrice: 659.98, date: '2026-10-06T16:00:00', status: 'completed' },
  { id: 'S006', productId: '7', productName: 'Silla Gamer ErgoChair', quantity: 4, totalPrice: 999.96, date: '2026-10-05T13:30:00', status: 'completed' },
  { id: 'S007', productId: '8', productName: 'SSD Samsung 1TB', quantity: 10, totalPrice: 1299.90, date: '2026-10-05T10:00:00', status: 'completed' },
  { id: 'S008', productId: '2', productName: 'Mouse Logitech MX Master 3', quantity: 3, totalPrice: 299.97, date: '2026-10-04T15:45:00', status: 'cancelled' }
];

export const mockSuppliers: Supplier[] = [
  { id: 'SUP001', name: 'Carlos Martínez', company: 'TechPro Distribuidores', phone: '+1 (555) 123-4567', email: 'carlos@techpro.com', address: 'Av. Tecnológica 123', products: ['1', '4'], notes: 'Proveedor principal de equipos Dell y LG. Entrega en 2-3 días.' },
  { id: 'SUP002', name: 'Ana Silva', company: 'Periféricos Global', phone: '+1 (555) 234-5678', email: 'ana.silva@perifsglobal.com', address: 'Calle Comercio 456', products: ['2', '3', '6'], notes: 'Especialista en Logitech. Descuentos por volumen disponibles.' },
  { id: 'SUP003', name: 'Roberto García', company: 'Audio Premier', phone: '+1 (555) 345-6789', email: 'r.garcia@audiopremier.com', address: 'Plaza Audio 789', products: ['5'], notes: 'Distribuidor oficial Sony. Stock permanente de auriculares.' },
  { id: 'SUP004', name: 'María López', company: 'Oficina Total', phone: '+1 (555) 456-7890', email: 'maria@oficinatotal.com', address: 'Parque Industrial 321', products: ['7'], notes: 'Muebles ergonómicos. Entrega e instalación incluida.' },
  { id: 'SUP005', name: 'José Ramírez', company: 'StoragePlus', phone: '+1 (555) 567-8901', email: 'jose@storageplus.com', address: 'Av. Digital 654', products: ['8'], notes: 'Componentes de almacenamiento. Precios competitivos en SSD.' }
];

export const mockTraslados: Traslado[] = [
  { id: 'T001', origen: 'S3', destino: 'S1', estado: 'en_transito', items: [{ productoId: '1', nombre: 'Laptop Dell XPS 15', cantidad: 3 }, { productoId: '8', nombre: 'SSD Samsung 1TB', cantidad: 10 }], fechaCreacion: '2026-10-06T08:00:00', fechaEnvio: '2026-10-06T14:00:00', notas: 'Reabastecimiento urgente' },
  { id: 'T002', origen: 'S1', destino: 'S2', estado: 'pendiente', items: [{ productoId: '2', nombre: 'Mouse Logitech MX Master 3', cantidad: 5 }], fechaCreacion: '2026-10-07T09:00:00', notas: 'Transferencia mensual' },
  { id: 'T003', origen: 'S3', destino: 'S2', estado: 'recibido', items: [{ productoId: '5', nombre: 'Auriculares Sony WH-1000XM4', cantidad: 8 }], fechaCreacion: '2026-10-04T10:00:00', fechaEnvio: '2026-10-04T15:00:00', fechaRecepcion: '2026-10-05T11:00:00' },
];

export const mockLotes: Lote[] = [
  { id: 'L001', productoId: '1', numero: 'DELL-2026-001', fechaVencimiento: undefined, cantidad: 5, sucursalId: 'S1' },
  { id: 'L002', productoId: '5', numero: 'SONY-2026-043', fechaVencimiento: '2028-06-30', cantidad: 22, sucursalId: 'S1' },
];

// ─── Restaurant mock data ─────────────────────────────────────────────────────

export const mockMesas: Mesa[] = [
  { id: 'M1', numero: 1, zona: 'Terraza', capacidad: 4, estado: 'libre' },
  { id: 'M2', numero: 2, zona: 'Terraza', capacidad: 2, estado: 'ocupada' },
  { id: 'M3', numero: 3, zona: 'Interior', capacidad: 6, estado: 'por_cobrar' },
  { id: 'M4', numero: 4, zona: 'Interior', capacidad: 4, estado: 'reservada' },
  { id: 'M5', numero: 5, zona: 'Interior', capacidad: 4, estado: 'libre' },
  { id: 'M6', numero: 6, zona: 'Barra', capacidad: 2, estado: 'ocupada' },
  { id: 'M7', numero: 7, zona: 'Barra', capacidad: 2, estado: 'libre' },
  { id: 'M8', numero: 8, zona: 'Terraza', capacidad: 8, estado: 'libre' },
];

export const mockComandas: Comanda[] = [
  {
    id: 'CMD001', mesaId: 'M2', mesaNumero: 2, estado: 'en_cocina',
    items: [
      { id: 'CI1', productoId: 'P1', nombre: 'Tacos de Birria x3', cantidad: 1, precio: 95, estado: 'en_preparacion', estacion: 'cocina', tiempo: 8 },
      { id: 'CI2', productoId: 'P2', nombre: 'Agua de Jamaica', cantidad: 2, precio: 30, estado: 'listo', estacion: 'barra', tiempo: 3 },
    ],
    mesero: 'Luis Torres', fechaApertura: '2026-10-07T13:10:00', fechaEnvioCocina: '2026-10-07T13:15:00'
  },
  {
    id: 'CMD002', mesaId: 'M3', mesaNumero: 3, estado: 'lista',
    items: [
      { id: 'CI3', productoId: 'P3', nombre: 'Enchiladas Verdes', cantidad: 2, precio: 110, estado: 'listo', estacion: 'cocina', tiempo: 20 },
      { id: 'CI4', productoId: 'P4', nombre: 'Pozole Rojo', cantidad: 1, precio: 120, estado: 'listo', estacion: 'cocina', tiempo: 18 },
      { id: 'CI5', productoId: 'P5', nombre: 'Cerveza Artesanal', cantidad: 3, precio: 60, estado: 'entregado', estacion: 'barra' },
    ],
    mesero: 'Diana Reyes', fechaApertura: '2026-10-07T12:45:00', fechaEnvioCocina: '2026-10-07T12:50:00'
  },
  {
    id: 'CMD003', mesaId: 'M6', mesaNumero: 6, estado: 'en_cocina',
    items: [
      { id: 'CI6', productoId: 'P6', nombre: 'Orden de Chilaquiles', cantidad: 1, precio: 85, estado: 'nuevo', estacion: 'cocina', tiempo: 2 },
      { id: 'CI7', productoId: 'P7', nombre: 'Café Americano', cantidad: 1, precio: 35, estado: 'en_preparacion', estacion: 'barra', tiempo: 2 },
    ],
    mesero: 'Luis Torres', fechaApertura: '2026-10-07T13:20:00', fechaEnvioCocina: '2026-10-07T13:22:00'
  },
];

// ─── Hotel mock data ──────────────────────────────────────────────────────────

export const mockHabitaciones: Habitacion[] = [
  { id: 'H1', numero: '101', tipo: 'simple', piso: 1, estado: 'ocupada', estadoLimpieza: 'sucia', precio: 850, capacidad: 1, amenidades: ['WiFi', 'TV', 'AC'] },
  { id: 'H2', numero: '102', tipo: 'doble', piso: 1, estado: 'disponible', estadoLimpieza: 'lista', precio: 1200, capacidad: 2, amenidades: ['WiFi', 'TV', 'AC', 'Frigobar'] },
  { id: 'H3', numero: '103', tipo: 'doble', piso: 1, estado: 'limpieza', estadoLimpieza: 'en_limpieza', precio: 1200, capacidad: 2, amenidades: ['WiFi', 'TV', 'AC', 'Frigobar'] },
  { id: 'H4', numero: '201', tipo: 'suite', piso: 2, estado: 'ocupada', estadoLimpieza: 'sucia', precio: 2500, capacidad: 4, amenidades: ['WiFi', 'TV', 'AC', 'Jacuzzi', 'Balcón'] },
  { id: 'H5', numero: '202', tipo: 'familiar', piso: 2, estado: 'disponible', estadoLimpieza: 'inspeccionada', precio: 1800, capacidad: 5, amenidades: ['WiFi', 'TV', 'AC', 'Frigobar', 'Cocina'] },
  { id: 'H6', numero: '203', tipo: 'simple', piso: 2, estado: 'mantenimiento', estadoLimpieza: 'sucia', precio: 850, capacidad: 1, amenidades: ['WiFi', 'TV'] },
  { id: 'H7', numero: '301', tipo: 'suite', piso: 3, estado: 'disponible', estadoLimpieza: 'lista', precio: 3200, capacidad: 2, amenidades: ['WiFi', '4K TV', 'AC', 'Jacuzzi', 'Terraza privada'] },
  { id: 'H8', numero: '302', tipo: 'doble', piso: 3, estado: 'ocupada', estadoLimpieza: 'sucia', precio: 1400, capacidad: 2, amenidades: ['WiFi', 'TV', 'AC', 'Frigobar', 'Vista al mar'] },
];

export const mockReservasHotel: ReservaHotel[] = [
  { id: 'RH001', habitacionId: 'H1', huesped: 'Sofía Mendoza', email: 'sofia@email.com', telefono: '+52 55 1234-5678', checkIn: '2026-10-06', checkOut: '2026-10-09', estado: 'checkin', anticipo: 850, totalCargos: 2550, noches: 3 },
  { id: 'RH002', habitacionId: 'H4', huesped: 'Roberto Díaz', email: 'roberto@email.com', telefono: '+52 55 9876-5432', checkIn: '2026-10-05', checkOut: '2026-10-08', estado: 'checkin', anticipo: 2500, totalCargos: 7500, noches: 3 },
  { id: 'RH003', habitacionId: 'H8', huesped: 'Carmen Vega', email: 'carmen@email.com', telefono: '+52 55 5555-4444', checkIn: '2026-10-07', checkOut: '2026-10-10', estado: 'checkin', anticipo: 1400, totalCargos: 4200, noches: 3 },
  { id: 'RH004', habitacionId: 'H2', huesped: 'Marco Aurelio Torres', email: 'marco@email.com', telefono: '+52 55 1111-2222', checkIn: '2026-10-09', checkOut: '2026-10-12', estado: 'confirmada', totalCargos: 3600, noches: 3 },
];

// ─── Services mock data ───────────────────────────────────────────────────────

export const mockServicios: Servicio[] = [
  { id: 'SV1', nombre: 'Corte de cabello', duracion: 45, precio: 180, categoria: 'Cabello', color: '#f97316' },
  { id: 'SV2', nombre: 'Tinte completo', duracion: 120, precio: 450, categoria: 'Cabello', color: '#fb923c' },
  { id: 'SV3', nombre: 'Manicure', duracion: 60, precio: 150, categoria: 'Uñas', color: '#ec4899' },
  { id: 'SV4', nombre: 'Pedicure', duracion: 75, precio: 180, categoria: 'Uñas', color: '#a855f7' },
  { id: 'SV5', nombre: 'Masaje relajante', duracion: 60, precio: 350, categoria: 'Spa', color: '#22c55e' },
  { id: 'SV6', nombre: 'Facial limpieza profunda', duracion: 90, precio: 420, categoria: 'Spa', color: '#06b6d4' },
];

export const mockProfesionales: Profesional[] = [
  { id: 'PR1', nombre: 'Andrea Guzmán', especialidad: 'Estilista Senior', color: '#f97316', horario: [{ dia: 1, inicio: '09:00', fin: '18:00' }, { dia: 2, inicio: '09:00', fin: '18:00' }, { dia: 3, inicio: '09:00', fin: '18:00' }, { dia: 4, inicio: '09:00', fin: '18:00' }, { dia: 5, inicio: '09:00', fin: '18:00' }] },
  { id: 'PR2', nombre: 'Karla Soto', especialidad: 'Manicurista', color: '#ec4899', horario: [{ dia: 1, inicio: '10:00', fin: '19:00' }, { dia: 2, inicio: '10:00', fin: '19:00' }, { dia: 3, inicio: '10:00', fin: '19:00' }, { dia: 4, inicio: '10:00', fin: '19:00' }, { dia: 6, inicio: '10:00', fin: '15:00' }] },
  { id: 'PR3', nombre: 'Miguel Ríos', especialidad: 'Masajista', color: '#22c55e', horario: [{ dia: 2, inicio: '09:00', fin: '17:00' }, { dia: 3, inicio: '09:00', fin: '17:00' }, { dia: 4, inicio: '09:00', fin: '17:00' }, { dia: 5, inicio: '09:00', fin: '17:00' }, { dia: 6, inicio: '09:00', fin: '14:00' }] },
];

export const mockClientes: Cliente[] = [
  { id: 'CL1', nombre: 'Valentina Cruz', email: 'vale@email.com', telefono: '+52 55 1234-0000', citasIds: ['CT1', 'CT3'] },
  { id: 'CL2', nombre: 'Patricio Morales', email: 'pato@email.com', telefono: '+52 55 2345-0000', citasIds: ['CT2'] },
  { id: 'CL3', nombre: 'Isabella Fernández', email: 'isa@email.com', telefono: '+52 55 3456-0000', citasIds: ['CT4'] },
];

export const mockCitas: Cita[] = [
  { id: 'CT1', clienteId: 'CL1', clienteNombre: 'Valentina Cruz', servicioId: 'SV1', servicioNombre: 'Corte de cabello', profesionalId: 'PR1', profesionalNombre: 'Andrea Guzmán', fecha: '2026-10-07', horaInicio: '10:00', horaFin: '10:45', estado: 'confirmada' },
  { id: 'CT2', clienteId: 'CL2', clienteNombre: 'Patricio Morales', servicioId: 'SV5', servicioNombre: 'Masaje relajante', profesionalId: 'PR3', profesionalNombre: 'Miguel Ríos', fecha: '2026-10-07', horaInicio: '11:00', horaFin: '12:00', estado: 'reservada' },
  { id: 'CT3', clienteId: 'CL1', clienteNombre: 'Valentina Cruz', servicioId: 'SV3', servicioNombre: 'Manicure', profesionalId: 'PR2', profesionalNombre: 'Karla Soto', fecha: '2026-10-07', horaInicio: '14:00', horaFin: '15:00', estado: 'confirmada' },
  { id: 'CT4', clienteId: 'CL3', clienteNombre: 'Isabella Fernández', servicioId: 'SV2', servicioNombre: 'Tinte completo', profesionalId: 'PR1', profesionalNombre: 'Andrea Guzmán', fecha: '2026-10-08', horaInicio: '09:30', horaFin: '11:30', estado: 'reservada' },
  { id: 'CT5', clienteId: 'CL2', clienteNombre: 'Patricio Morales', servicioId: 'SV6', servicioNombre: 'Facial limpieza profunda', profesionalId: 'PR3', profesionalNombre: 'Miguel Ríos', fecha: '2026-10-09', horaInicio: '15:00', horaFin: '16:30', estado: 'reservada' },
];

// ─── Users & Roles ────────────────────────────────────────────────────────────

export const mockUsuarios: Usuario[] = [
  { id: 'U1', nombre: 'Admin Principal', email: 'admin@empresa.com', rol: 'administrador', activo: true, ultimoAcceso: '2026-10-07T08:30:00' },
  { id: 'U2', nombre: 'Luis Torres', email: 'luis@empresa.com', rol: 'cajero', sucursalId: 'S1', activo: true, ultimoAcceso: '2026-10-07T09:00:00' },
  { id: 'U3', nombre: 'Diana Reyes', email: 'diana@empresa.com', rol: 'mesero', sucursalId: 'S1', activo: true, ultimoAcceso: '2026-10-07T08:45:00' },
  { id: 'U4', nombre: 'Marco Herrera', email: 'marco@empresa.com', rol: 'recepcionista', sucursalId: 'S2', activo: true, ultimoAcceso: '2026-10-06T17:00:00' },
  { id: 'U5', nombre: 'Sofía Castillo', email: 'sofia@empresa.com', rol: 'profesional', sucursalId: 'S1', activo: false, ultimoAcceso: '2026-10-01T12:00:00' },
];

export const mockActividades: RegistroActividad[] = [
  { id: 'A1', usuarioId: 'U2', usuarioNombre: 'Luis Torres', modulo: 'POS', accion: 'Venta procesada', fecha: '2026-10-07T11:45:00', detalle: 'Ticket POS-1728294300 · $499.95' },
  { id: 'A2', usuarioId: 'U1', usuarioNombre: 'Admin Principal', modulo: 'Productos', accion: 'Producto actualizado', fecha: '2026-10-07T10:30:00', detalle: 'Laptop Dell XPS 15 · stock ajustado' },
  { id: 'A3', usuarioId: 'U3', usuarioNombre: 'Diana Reyes', modulo: 'Mesas', accion: 'Comanda enviada a cocina', fecha: '2026-10-07T12:50:00', detalle: 'Mesa 3 · CMD002' },
  { id: 'A4', usuarioId: 'U4', usuarioNombre: 'Marco Herrera', modulo: 'Hotel', accion: 'Check-in realizado', fecha: '2026-10-07T09:15:00', detalle: 'Hab. 302 · Carmen Vega' },
  { id: 'A5', usuarioId: 'U1', usuarioNombre: 'Admin Principal', modulo: 'Usuarios', accion: 'Usuario desactivado', fecha: '2026-10-07T08:00:00', detalle: 'Sofía Castillo' },
  { id: 'A6', usuarioId: 'U2', usuarioNombre: 'Luis Torres', modulo: 'POS', accion: 'Turno abierto', fecha: '2026-10-07T09:00:00', detalle: 'Monto inicial: $2,000.00' },
];

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getLowStockProducts() {
  return mockProducts.filter(p => p.stock < p.minStock);
}

export function getTodaySales() {
  const today = new Date().toDateString();
  return mockSales.filter(s => new Date(s.date).toDateString() === today);
}

export function getTotalRevenue() {
  return mockSales.filter(s => s.status === 'completed').reduce((sum, sale) => sum + sale.totalPrice, 0);
}

export function getSalesStats() {
  const today = getTodaySales();
  const completed = mockSales.filter(s => s.status === 'completed');
  return {
    todaySales: today.length,
    totalSales: mockSales.length,
    totalRevenue: getTotalRevenue(),
    completedSales: completed.length,
    pendingSales: mockSales.filter(s => s.status === 'pending').length,
    lowStockItems: getLowStockProducts().length
  };
}

export function getSuppliersForProduct(productId: string) {
  return mockSuppliers.filter(s => s.products.includes(productId));
}

export function getProductsBySupplier(supplierId: string) {
  const supplier = mockSuppliers.find(s => s.id === supplierId);
  if (!supplier) return [];
  return mockProducts.filter(p => supplier.products.includes(p.id));
}

export function findProductByBarcode(code: string): Product | null {
  const cb = mockCodigosBarras.find(c => c.codigo === code);
  if (!cb) return null;
  return mockProducts.find(p => p.id === cb.productoId) || null;
}
