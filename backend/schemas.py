from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.core.config import DEFAULT_TAX_RATE, DISCRETE_UNITS
from backend.core.security import DELEGABLE_PERMISSIONS


class PlatformCreateUserPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["superadmin", "owner", "business_admin", "cashier"]
    businessId: str | None = Field(default=None, max_length=80)

    @field_validator("email")
    @classmethod
    def normalize_platform_email(cls, value: str):
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Introduce un correo electrónico válido.")
        return normalized


class ProductPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sku: str = Field(default="", max_length=60)  # empty: the server generates one
    category: str = Field(min_length=2, max_length=80)
    price: float = Field(ge=0)
    stock: float = Field(ge=0)
    minStock: float = Field(ge=0)
    description: str = Field(default="", max_length=1000)
    image: str = Field(default="", max_length=120)
    cost: float = Field(default=0, ge=0)
    productType: Literal["sale_item", "ingredient", "supplies"] = "sale_item"
    unit: str = Field(default="unidad", max_length=32)
    supplierId: str | None = Field(default=None, max_length=80)
    barcode: str = Field(default="", max_length=120)
    trackLots: bool = False
    defaultLocationId: str | None = Field(default=None, max_length=80)

    @field_validator("sku")
    @classmethod
    def normalize_sku(cls, value: str):
        value = value.strip().upper()
        if len(value) == 1:
            raise ValueError("El código debe tener entre 2 y 60 caracteres.")
        return value

    @field_validator("name", "category", "unit")
    @classmethod
    def normalize_text_fields(cls, value: str):
        return " ".join(value.split())

    @model_validator(mode="after")
    def validate_stock_precision(self):
        unit = unicodedata.normalize("NFKD", self.unit).encode("ascii", "ignore").decode().casefold()
        if unit in DISCRETE_UNITS and (not float(self.stock).is_integer() or not float(self.minStock).is_integer()):
            raise ValueError("Las existencias y el stock mínimo deben ser números enteros para esta unidad de medida.")
        return self


class ProductImagePayload(BaseModel):
    # ~500 KB of image once base64-decoded, plus the data-URL header.
    dataUrl: str = Field(min_length=20, max_length=700_000)


class ProductImportPayload(BaseModel):
    fileName: str = Field(min_length=5, max_length=200)
    # A little over 2 MB once base64-decoded, so the 2 MB check in the service gives the friendly message.
    dataUrl: str = Field(min_length=20, max_length=2_900_000)


class ProductCategoryPayload(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=400)
    active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str):
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("El nombre de categoría debe tener al menos dos caracteres.")
        return value


class HotelRoomPayload(BaseModel):
    roomNumber: str = Field(min_length=1, max_length=20)
    roomType: Literal["simple", "single", "double", "suite", "deluxe", "familiar"] = "double"
    floor: int = Field(default=1, ge=0, le=200)
    capacity: int = Field(default=2, ge=1, le=50)
    pricePerNight: float = Field(default=0, ge=0)
    status: Literal["available", "occupied", "reserved", "maintenance", "cleaning"] = "available"
    amenities: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("roomNumber")
    @classmethod
    def normalize_room_number(cls, value: str):
        value = " ".join(value.split()).upper()
        if not value:
            raise ValueError("El número de habitación es obligatorio.")
        return value


class HotelReservationPayload(BaseModel):
    roomId: str = Field(min_length=1, max_length=80)
    guestName: str = Field(min_length=2, max_length=120)
    guestEmail: str = Field(default="", max_length=160)
    guestPhone: str = Field(default="", max_length=40)
    checkIn: str
    checkOut: str
    advance: float = Field(default=0, ge=0)

    @field_validator("guestName")
    @classmethod
    def normalize_guest_name(cls, value: str):
        return " ".join(value.split())

    @model_validator(mode="after")
    def validate_dates(self):
        try:
            start = datetime.strptime(self.checkIn, "%Y-%m-%d").date()
            end = datetime.strptime(self.checkOut, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("Las fechas de check-in y check-out deben usar AAAA-MM-DD.") from exc
        if end <= start:
            raise ValueError("El check-out debe ser posterior al check-in.")
        return self


class HotelReservationStatusPayload(BaseModel):
    status: Literal["confirmed", "checkin", "checkout", "cancelled"]


class ServicePayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    durationMinutes: int = Field(default=30, gt=0, le=1440)
    price: float = Field(default=0, ge=0)
    category: str = Field(default="Servicios principales", max_length=80)
    color: str = Field(default="#315F68", pattern=r"^#[0-9a-fA-F]{6}$")


class ProfessionalPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    specialty: str = Field(default="", max_length=120)
    color: str = Field(default="#315F68", pattern=r"^#[0-9a-fA-F]{6}$")
    availability: list[dict] = Field(default_factory=list, max_length=100)


class AppointmentPayload(BaseModel):
    serviceId: str = Field(min_length=1, max_length=80)
    professionalId: str = Field(min_length=1, max_length=80)
    clientName: str = Field(min_length=2, max_length=120)
    clientEmail: str = Field(default="", max_length=160)
    clientPhone: str = Field(default="", max_length=40)
    appointmentDate: str
    startTime: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    notes: str = Field(default="", max_length=1000)

    @field_validator("clientName")
    @classmethod
    def normalize_client_name(cls, value: str):
        return " ".join(value.split())

    @field_validator("appointmentDate")
    @classmethod
    def validate_appointment_date(cls, value: str):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("La fecha debe usar AAAA-MM-DD.") from exc
        return value


class AppointmentStatusPayload(BaseModel):
    status: Literal["reserved", "confirmed", "attended", "cancelled", "no_show"]


class SaleItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000)
    discountPercent: float = Field(default=0, ge=0, le=100)


class PaymentPartPayload(BaseModel):
    method: Literal["cash", "card", "digital", "transfer"]
    amount: float = Field(ge=0)


class SalePayload(BaseModel):
    idempotencyKey: str = Field(min_length=8, max_length=100)
    items: list[SaleItemPayload] = Field(default_factory=list, max_length=200)
    orderIds: list[str] = Field(default_factory=list, max_length=200)
    appointmentIds: list[str] = Field(default_factory=list, max_length=50)
    customer: str = Field(default="Cliente general", max_length=120)
    paymentMethod: Literal["cash", "card", "digital", "split", "transfer"] = "cash"
    payments: list[PaymentPartPayload] = Field(default_factory=list, max_length=10)
    cashSessionId: str | None = None
    globalDiscountPercent: float = Field(default=0, ge=0, le=100)
    taxRate: float = Field(default=DEFAULT_TAX_RATE, ge=0, le=0.3)
    status: Literal["completed", "pending"] = "completed"


class SupplierPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    company: str = Field(min_length=2, max_length=160)
    phone: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=160)
    address: str = Field(default="", max_length=240)
    products: list[str] = []
    notes: str = Field(default="", max_length=1000)


class RegisterPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    businessName: str | None = Field(default=None, max_length=160)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str):
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Ingresa un correo válido.")
        return value


class LoginPayload(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str):
        return value.strip().lower()


class BusinessConfigPayload(BaseModel):
    type: Literal["retail", "restaurant", "hotel", "warehouse", "services"]
    name: str = Field(min_length=2, max_length=160)
    currency: str = Field(default="COP", min_length=3, max_length=3)
    taxRate: float = Field(default=0.19, ge=0, le=1)
    features: dict[str, bool]
    foodConfig: dict | None = None
    theme: dict | None = None
    inventoryConfig: dict | None = None

    @field_validator("theme")
    @classmethod
    def validate_theme(cls, value: dict | None):
        if value is None:
            return None
        color_keys = ("primary", "secondary", "accent", "background", "surface", "lightBackground", "lightSurface", "darkBackground", "darkSurface")
        for key in color_keys:
            color = value.get(key)
            if color is None and key in {"lightBackground", "lightSurface", "darkBackground", "darkSurface"}:
                continue
            if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ValueError(f"El color {key} debe estar en formato hexadecimal #RRGGBB.")
        if value.get("mode", "light") not in {"light", "dark"}:
            raise ValueError("El modo de apariencia debe ser light o dark.")
        if "customized" in value and not isinstance(value["customized"], bool):
            raise ValueError("El indicador de personalización debe ser booleano.")
        allowed = set(color_keys) | {"mode", "customized"}
        if set(value) - allowed:
            raise ValueError("La configuración visual contiene propiedades desconocidas.")
        return value


class CreateStaffPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["business_admin", "cashier"] = "cashier"
    customRoleId: str | None = Field(default=None, max_length=80)


class UpdateStaffPayload(BaseModel):
    role: Literal["business_admin", "cashier"] | None = None
    customRoleId: str | None = Field(default=None, max_length=80)
    active: bool | None = None


class CustomRolePayload(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    permissions: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("name")
    @classmethod
    def normalize_role_name(cls, value: str):
        return " ".join(value.split())

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, value: list[str]):
        clean = list(dict.fromkeys(value))
        invalid = set(clean) - DELEGABLE_PERMISSIONS
        if invalid:
            raise ValueError("El rol contiene permisos no delegables.")
        return clean


class SupportMessagePayload(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError("El mensaje no puede estar vacío.")
        return value


class SupportStatusPayload(BaseModel):
    status: Literal["open", "in_review", "awaiting_business", "resolved", "closed"]
