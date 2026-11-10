"""Security and atomic-sales integration smoke tests on a disposable SQLite DB."""
from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
os.environ["MANAGER_STOCK_BUSINESS_ID"] = "manager-stock-tests"
os.environ["MANAGER_STOCK_BUSINESS_NAME"] = "Negocio de pruebas"
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app, connection, hash_password  # noqa: E402


def run() -> None:
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/products").status_code == 401, "Business API must require auth"
        assert client.post("/api/auth/register", json={"name": "Propietario Prueba", "email": "owner@test.local", "password": "PruebaSegura123!"}).status_code == 201
        login = client.post("/api/auth/login", json={"email": "owner@test.local", "password": "PruebaSegura123!"})
        assert login.status_code == 200, login.text
        auth = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert login.json()["user"]["role"] == "owner"
        assert client.get("/api/dashboard", headers=auth).status_code == 200
        assert client.post("/api/auth/register", json={"name": "Otra Persona", "email": "owner@test.local", "password": "PruebaSegura123!"}).status_code == 409
        assert client.post("/api/auth/login", json={"email": "owner@test.local", "password": "incorrecta"}).status_code == 401

        config = {
            "type": "restaurant", "name": "Comidas de prueba", "currency": "COP", "taxRate": 0,
            "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False, "warehouse": False, "services": False, "delivery": False},
            "foodConfig": {"serviceModes": ["mostrador", "para_llevar"], "foodTypes": ["hamburguesas"], "activeModules": ["menu", "caja", "inventario", "pedidos"], "displayLabel": "Negocio de comidas"},
        }
        config["theme"] = {"primary":"#A95F45", "secondary":"#C79658", "accent":"#DCA184", "background":"#FBF6F0", "surface":"#FFFFFF", "lightBackground":"#FBF6F0", "lightSurface":"#FFFFFF", "darkBackground":"#211914", "darkSurface":"#30241E", "mode":"light", "customized":False}
        saved_config = client.put("/api/business/config", headers=auth, json=config)
        assert saved_config.status_code == 200, saved_config.text
        assert saved_config.json()["theme"]["primary"] == "#A95F45"
        assert client.get("/api/business/config", headers=auth).json()["type"] == "restaurant"
        current_subscription = client.get("/api/subscription", headers=auth)
        assert current_subscription.status_code == 200 and current_subscription.json()["plan"]["id"] == "free"
        free_plan_staff = client.post("/api/users", headers=auth, json={"name":"Empleado bloqueado por límite", "email":"free-limit@test.local", "password":"EmpleadoSeguro123!", "role":"cashier"})
        assert free_plan_staff.status_code == 409, free_plan_staff.text
        pending_plan = client.put("/api/subscription", headers=auth, json={"planId":"entrepreneur"})
        assert pending_plan.status_code == 200 and pending_plan.json()["status"] == "pending_payment" and pending_plan.json()["plan"]["id"] == "free", pending_plan.text
        # Paid plan selection must not pretend payment was completed.
        # Suggested categories are based on the tenant's business type and custom categories remain tenant scoped.
        category_response = client.get("/api/product-categories", headers=auth)
        assert category_response.status_code == 200 and any(item["name"] == "Hamburguesas" for item in category_response.json())
        created_category = client.post("/api/product-categories", headers=auth, json={"name":"Bebidas Artesanales", "description":"Categoría propia"})
        assert created_category.status_code == 201, created_category.text
        duplicate_category = client.post("/api/product-categories", headers=auth, json={"name":"  bebidas   artesanales ", "description":"Duplicado por espacios y mayúsculas"})
        assert duplicate_category.status_code == 409, duplicate_category.text
        equivalent_default = client.post("/api/product-categories", headers=auth, json={"name":"COMIDAS RAPIDAS"})
        assert equivalent_default.status_code == 409, equivalent_default.text
        invalid_theme_config = {**config, "theme": {**config["theme"], "primary":"red; color: lime"}}
        assert client.put("/api/business/config", headers=auth, json=invalid_theme_config).status_code == 422
        recipes = client.get("/api/recipes", headers=auth)
        assert recipes.status_code == 200, recipes.text
        assert recipes.json() == []

        def create_product(name: str, sku: str, price: float, cost: float, stock: float):
            response = client.post("/api/products", headers=auth, json={
                "name": name, "sku": sku, "category": "Comidas rápidas", "price": price,
                "cost": cost, "stock": stock, "minStock": 2, "description": "Producto de prueba",
                "image": "", "productType": "sale_item", "unit": "unidad",
            })
            assert response.status_code == 201, response.text
            return response.json()

        decimal_discrete_stock = client.post("/api/products", headers=auth, json={"name":"Stock fraccionado","sku":"STOCK-DECIMAL","category":"Comidas rápidas","price":1,"cost":0,"stock":1.2,"minStock":1,"unit":"unidad"})
        assert decimal_discrete_stock.status_code == 422, decimal_discrete_stock.text
        burger = create_product("Hamburguesa de prueba", "HAM-TEST", 18000, 7200, 32)
        empanada = create_product("Empanada de prueba", "EMP-TEST", 3500, 1200, 80)
        products = client.get("/api/products", headers=auth)
        assert products.status_code == 200
        before_burger = next(p for p in products.json() if p["id"] == burger["id"])["stock"]
        before_empanada = next(p for p in products.json() if p["id"] == empanada["id"])["stock"]
        payload = {
            "idempotencyKey": "test-sale-idempotency-001",
            "items": [
                {"productId": burger["id"], "quantity": 2, "discountPercent": 0},
                {"productId": empanada["id"], "quantity": 1, "discountPercent": 0},
            ], "customer": "Cliente de prueba", "paymentMethod": "cash", "taxRate": 0, "status": "completed",
        }
        first = client.post("/api/sales", headers=auth, json=payload)
        assert first.status_code == 201, first.text
        sale = first.json()
        assert len(sale["items"]) == 2, sale
        assert sale["totalPrice"] == 39500, sale["totalPrice"]
        assert all("unitCost" in item for item in sale["items"]), sale["items"]
        assert sale["date"].endswith("+00:00"), sale["date"]

        current_burger = next(p for p in client.get("/api/products", headers=auth).json() if p["id"] == burger["id"])
        current_burger["cost"] = 99999
        edited = client.put(f"/api/products/{burger['id']}", headers=auth, json=current_burger)
        assert edited.status_code == 200, edited.text
        historic = client.get(f"/api/sales/{sale['id']}", headers=auth).json()
        historic_burger = next(item for item in historic["items"] if item["productId"] == burger["id"])
        assert historic_burger["unitCost"] == 7200, historic_burger

        retry = client.post("/api/sales", headers=auth, json=payload)
        assert retry.status_code == 201, retry.text
        assert retry.json()["id"] == sale["id"]
        refreshed = {product["id"]: product for product in client.get("/api/products", headers=auth).json()}
        assert refreshed[burger["id"]]["stock"] == before_burger - 2
        assert refreshed[empanada["id"]]["stock"] == before_empanada - 1
        # The batched list must return exactly what the per-sale detail returns (items, payments, totals).
        listed = client.get("/api/sales", headers=auth).json()
        assert listed and listed[0]["items"] and listed[0]["payments"] is not None
        for listed_sale in listed:
            assert listed_sale == client.get(f"/api/sales/{listed_sale['id']}", headers=auth).json()
        page_one = client.get("/api/sales?limit=1&offset=0", headers=auth).json()
        page_two = client.get("/api/sales?limit=1&offset=1", headers=auth).json()
        assert len(page_one) == 1 and page_one[0]["id"] == sale["id"]
        assert page_two == []

        cancelled = client.post(f"/api/sales/{sale['id']}/cancel", headers=auth)
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled"
        after_cancel = {product["id"]: product for product in client.get("/api/products", headers=auth).json()}
        assert after_cancel[burger["id"]]["stock"] == before_burger
        assert after_cancel[empanada["id"]]["stock"] == before_empanada

        events = client.get("/api/audit", headers=auth).json()
        assert events and events[0]["createdAt"].endswith("+00:00"), events[:1]
        assert any(event["action"] == "create" and event["entityId"] == sale["id"] for event in events)
        assert any(event["action"] == "cancel" and event["entityId"] == sale["id"] for event in events)

        # Business-type changes keep existing data; menu-only food mode can still manage its catalog.
        menu_only_config = {
            **config,
            "features": {**config["features"], "inventory": False, "pos": False, "tables": False, "delivery": False},
            "foodConfig": {**config["foodConfig"], "activeModules": ["menu"]},
        }
        menu_only_saved = client.put("/api/business/config", headers=auth, json=menu_only_config)
        assert menu_only_saved.status_code == 200, menu_only_saved.text
        assert client.get("/api/products", headers=auth).status_code == 200
        assert client.get("/api/sales", headers=auth).status_code == 403
        assert client.get("/api/orders", headers=auth).status_code == 403
        menu_item = create_product("Producto de menú sin stock", "MENU-ONLY-1", 2500, 800, 0)
        retail_config = {
            "type": "retail", "name": "Negocio reconfigurado", "currency": "COP", "taxRate": 0,
            "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False, "warehouse": False, "services": False, "delivery": False},
        }
        switched = client.put("/api/business/config", headers=auth, json=retail_config)
        assert switched.status_code == 200, switched.text
        assert any(product["id"] == menu_item["id"] for product in client.get("/api/products", headers=auth).json())
        assert any(item["id"] == sale["id"] for item in client.get("/api/sales", headers=auth).json())
        transitions = client.get("/api/business/type-transitions", headers=auth)
        assert transitions.status_code == 200 and any(item["oldType"] == "restaurant" and item["newType"] == "retail" for item in transitions.json()), transitions.text
        active_transition = next(item for item in transitions.json() if item["oldType"] == "restaurant" and item["newType"] == "retail")
        transition_start = datetime.fromisoformat(active_transition["createdAt"].replace("Z", "+00:00"))
        transition_expiry = datetime.fromisoformat(active_transition["expiresAt"].replace("Z", "+00:00"))
        assert timedelta(days=14, hours=23) <= transition_expiry - transition_start <= timedelta(days=15, minutes=1), active_transition
        restored_type = client.post(f"/api/business/type-transitions/{active_transition['id']}/restore", headers=auth)
        assert restored_type.status_code == 200, restored_type.text
        assert client.get("/api/business/config", headers=auth).json()["type"] == "restaurant"
        assert client.get("/api/recipes", headers=auth).status_code == 200

        # Tax is authoritative on the server; ignore a manipulated taxRate in the sale body.
        tax_config = {**config, "taxRate": 0.19}
        assert client.put("/api/business/config", headers=auth, json=tax_config).status_code == 200
        taxed_sale_response = client.post("/api/sales", headers=auth, json={
            "idempotencyKey": "sale-server-tax-001",
            "items": [{"productId": empanada["id"], "quantity": 1}],
            "paymentMethod": "cash", "taxRate": 0,
        })
        assert taxed_sale_response.status_code == 201, taxed_sale_response.text
        taxed_sale = taxed_sale_response.json()
        assert taxed_sale["taxRate"] == 0.19, taxed_sale
        assert taxed_sale["tax"] == 665 and taxed_sale["totalPrice"] == 4165, taxed_sale
        assert client.post(f"/api/sales/{taxed_sale['id']}/cancel", headers=auth).status_code == 200

        owner_sale_response = client.post("/api/sales", headers=auth, json={
            "idempotencyKey": "owner-dashboard-sale-001",
            "items": [{"productId": empanada["id"], "quantity": 1}],
            "paymentMethod": "cash", "taxRate": 0,
        })
        assert owner_sale_response.status_code == 201, owner_sale_response.text
        owner_dashboard = client.get("/api/dashboard", headers=auth)
        assert owner_dashboard.status_code == 200, owner_dashboard.text
        assert owner_dashboard.json()["revenueLast7Days"] >= owner_sale_response.json()["totalPrice"]

        # A second business cannot read the first business's products, sales, or idempotency keys.
        second_register = client.post("/api/auth/register", json={"name": "Otro Propietario", "email": "other-owner@test.local", "password": "OtraClaveSegura123!"})
        assert second_register.status_code == 201, second_register.text
        second_headers = {"Authorization": f"Bearer {second_register.json()['access_token']}"}
        second_config = {
            "type": "retail", "name": "Otro negocio", "currency": "COP", "taxRate": 0,
            "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False, "warehouse": False, "services": False, "delivery": False},
        }
        second_config_response = client.put("/api/business/config", headers=second_headers, json=second_config)
        assert second_config_response.status_code == 200, second_config_response.text
        assert client.get("/api/products", headers=second_headers).json() == []
        assert client.get(f"/api/sales/{sale['id']}", headers=second_headers).status_code == 404
        assert client.get("/api/sales/by-key/test-sale-idempotency-001", headers=second_headers).status_code == 404
        assert client.get("/api/platform/audit", headers=auth).status_code == 403

        # A SUPERADMIN is provisioned by an out-of-band backend procedure, not public registration.
        with connection() as conn:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,?,?,?,?,'superadmin',1)",
                         ("SA-TEST-0001", None, "Dueño de la plataforma", "superadmin@test.local", hash_password("SuperClaveSegura123!")))
        super_login = client.post("/api/auth/login", json={"email": "superadmin@test.local", "password": "SuperClaveSegura123!"})
        assert super_login.status_code == 200, super_login.text
        super_headers = {"Authorization": f"Bearer {super_login.json()['access_token']}"}
        assert super_login.json()["user"]["role"] == "superadmin"
        assert client.get("/api/platform/stats", headers=super_headers).status_code == 200
        platform_subscriptions = client.get("/api/platform/subscriptions", headers=super_headers)
        assert platform_subscriptions.status_code == 200 and any(item["businessId"] == login.json()["user"]["businessId"] for item in platform_subscriptions.json())
        assert client.get("/api/products", headers=super_headers).status_code == 403
        public_plans = client.get("/api/subscription/plans")
        assert public_plans.status_code == 200 and {plan["id"] for plan in public_plans.json()} == {"free", "entrepreneur", "business", "enterprise"}
        owner_business_id = login.json()["user"]["businessId"]
        verified_subscription = client.patch(f"/api/platform/subscriptions/{owner_business_id}", headers=super_headers, json={"action":"confirm_payment", "paymentReference":"TEST-VERIFIED-0001"})
        assert verified_subscription.status_code == 200 and verified_subscription.json()["plan"]["id"] == "entrepreneur" and verified_subscription.json()["status"] == "active", verified_subscription.text
        platform_created_user = client.post("/api/platform/users", headers=super_headers, json={"name":"Usuario creado por plataforma", "email":"platform-created@test.local", "password":"ClaveInicial123!", "role":"superadmin"})
        assert platform_created_user.status_code == 201, platform_created_user.text
        assert client.post("/api/platform/users", headers=auth, json={"name":"No autorizado", "email":"denied@test.local", "password":"ClaveInicial123!", "role":"owner", "businessId":owner_business_id}).status_code == 403
        from urllib.parse import urlencode
        suspended_query = urlencode({"active": "false", "reason": "Verificación administrativa pendiente", "description": "Se requiere aclarar la información de la cuenta."})
        suspended = client.patch(f"/api/platform/businesses/{owner_business_id}/status?{suspended_query}", headers=super_headers)
        assert suspended.status_code == 200, suspended.text
        assert client.get("/api/products", headers=auth).status_code == 403
        # The owner can still authenticate, review the suspension and communicate with the platform.
        owner_me_suspended = client.get("/api/auth/me", headers=auth)
        assert owner_me_suspended.status_code == 200 and owner_me_suspended.json()["businessActive"] is False, owner_me_suspended.text
        suspension_status = client.get("/api/suspension/status", headers=auth)
        assert suspension_status.status_code == 200 and suspension_status.json()["reason"] == "Verificación administrativa pendiente", suspension_status.text
        owner_message = client.post("/api/support/messages", headers=auth, json={"message": "Solicito aclaración sobre la suspensión."})
        assert owner_message.status_code == 201, owner_message.text
        cases = client.get("/api/platform/support/cases", headers=super_headers)
        assert cases.status_code == 200 and any(item["businessId"] == owner_business_id for item in cases.json()), cases.text
        own_case = next(item for item in cases.json() if item["businessId"] == owner_business_id)
        admin_messages = client.get(f"/api/platform/support/cases/{own_case['id']}/messages", headers=super_headers)
        assert admin_messages.status_code == 200 and len(admin_messages.json()) == 1, admin_messages.text
        admin_reply = client.post(f"/api/platform/support/cases/{own_case['id']}/messages", headers=super_headers, json={"message": "Recibimos tu solicitud y la revisaremos."})
        assert admin_reply.status_code == 201, admin_reply.text
        owner_messages = client.get("/api/support/messages", headers=auth)
        assert owner_messages.status_code == 200 and len(owner_messages.json()) == 2, owner_messages.text
        reactivated = client.patch(f"/api/platform/businesses/{owner_business_id}/status?active=true", headers=super_headers)
        assert reactivated.status_code == 200, reactivated.text
        global_events = client.get("/api/platform/audit", headers=super_headers)
        assert global_events.status_code == 200 and len(global_events.json()) >= 2, global_events.text

        # Food businesses manage recipes and ingredients; recipe-based sales deduct the registered ingredients.
        ingredient_created = client.post("/api/products", headers=auth, json={"name":"Harina de trigo","sku":"ING-FLOUR","category":"Comidas rapidas","price":0,"cost":3000,"stock":1000,"minStock":10,"productType":"ingredient","unit":"kg"})
        assert ingredient_created.status_code == 201, ingredient_created.text
        burger_recipe = client.post("/api/recipes", headers=auth, json={"productId": burger["id"], "yieldQuantity": 1, "instructions": "Cocinar la hamburguesa", "ingredients": [{"ingredientId": ingredient_created.json()["id"], "quantity": 2, "unit": "kg"}]})
        assert burger_recipe.status_code == 201, burger_recipe.text
        ingredient_id = ingredient_created.json()["id"]
        ingredient_before_recipe_sale = next(p for p in client.get("/api/products", headers=auth).json() if p["id"] == ingredient_id)["stock"]
        recipe_sale = client.post("/api/sales", headers=auth, json={"idempotencyKey":"recipe-sale-001","items":[{"productId": burger["id"], "quantity": 2, "discountPercent": 0}],"customer":"Cliente de receta","paymentMethod":"cash","taxRate":0})
        assert recipe_sale.status_code == 201, recipe_sale.text
        refreshed_recipe_products = {product["id"]: product for product in client.get("/api/products", headers=auth).json()}
        assert refreshed_recipe_products[burger["id"]]["stock"] == before_burger, refreshed_recipe_products[burger["id"]]
        assert refreshed_recipe_products[ingredient_id]["stock"] < ingredient_before_recipe_sale, refreshed_recipe_products[ingredient_id]
        recipe_cancel = client.post(f"/api/sales/{recipe_sale.json()['id']}/cancel", headers=auth)
        assert recipe_cancel.status_code == 200, recipe_cancel.text
        assert recipe_cancel.json()["status"] == "cancelled"
        # Split payment must have a complete payment breakdown to avoid paid totals with no recorded payment.
        invalid_split = client.post("/api/sales", headers=auth, json={"idempotencyKey":"split-without-payments-001","items":[{"productId":burger["id"],"quantity":1}],"paymentMethod":"split","taxRate":0})
        assert invalid_split.status_code == 422, invalid_split.text

        # Staff authorization, tenant isolation, and protected global route.

        # Custom roles must be tenant-bound, explicitly delegated, and unable to read anything without permission.
        with connection() as conn:
            conn.execute("INSERT INTO business_subscriptions (business_id,plan_id,status) VALUES (?, 'enterprise','active') ON CONFLICT(business_id) DO UPDATE SET plan_id='enterprise',status='active'", (owner_business_id,))
        custom_role = client.post("/api/custom-roles", headers=auth, json={"name": "Solo catálogo", "permissions": ["catalog.view"]})
        assert custom_role.status_code == 201, custom_role.text
        assert "dashboard.view" in custom_role.json()["permissions"]
        sales_role = client.post("/api/custom-roles", headers=auth, json={"name": "Ventas y caja", "permissions": ["sales.create"]})
        assert sales_role.status_code == 201, sales_role.text
        assert {"sales.create", "sales.view", "catalog.view", "cash.view", "cash.manage"}.issubset(set(sales_role.json()["permissions"]))
        assert client.post("/api/custom-roles", headers=auth, json={"name": "Rol no permitido", "permissions": ["platform.admin"]}).status_code == 422
        custom_staff = client.post("/api/users", headers=auth, json={"name": "Empleado catálogo", "email": "catalog-only@test.local", "password": "EmpleadoSeguro123!", "role": "cashier", "customRoleId": custom_role.json()["id"]})
        assert custom_staff.status_code == 201, custom_staff.text
        custom_login = client.post("/api/auth/login", json={"email": "catalog-only@test.local", "password": "EmpleadoSeguro123!"})
        assert custom_login.status_code == 200, custom_login.text
        custom_headers = {"Authorization": f"Bearer {custom_login.json()['access_token']}"}
        assert client.get("/api/dashboard", headers=custom_headers).status_code == 200
        assert client.get("/api/products", headers=custom_headers).status_code == 200
        assert client.get("/api/sales", headers=custom_headers).status_code == 403
        assert client.post("/api/sales", headers=custom_headers, json={"idempotencyKey":"no-sales-custom-role","items":[{"productId":burger["id"],"quantity":1}],"paymentMethod":"cash"}).status_code == 403
        assert client.get("/api/platform/stats", headers=custom_headers).status_code == 403

        staff = client.post("/api/users", headers=auth, json={"name": "Cajero Prueba", "email": "cashier@test.local", "password": "CajeroSeguro123!", "role": "cashier"})
        assert staff.status_code == 201, staff.text
        cashier_login = client.post("/api/auth/login", json={"email": "cashier@test.local", "password": "CajeroSeguro123!"})
        assert cashier_login.status_code == 200, cashier_login.text
        cashier_headers = {"Authorization": f"Bearer {cashier_login.json()['access_token']}"}
        cashier_dashboard_before_sale = client.get("/api/dashboard", headers=cashier_headers)
        assert cashier_dashboard_before_sale.status_code == 200, cashier_dashboard_before_sale.text
        assert cashier_dashboard_before_sale.json()["revenueLast7Days"] == 0, cashier_dashboard_before_sale.json()
        assert client.get("/api/users", headers=cashier_headers).status_code == 403
        assert client.post("/api/products", headers=cashier_headers, json={"name":"Copia","sku":"COPY-1","category":"Prueba","price":1,"stock":1,"minStock":0}).status_code == 403
        assert client.get("/api/products", headers=cashier_headers).status_code == 200
        assert client.get("/api/sales/by-key/test-sale-idempotency-001", headers=cashier_headers).status_code == 404
        assert client.get("/api/platform/stats", headers=auth).status_code == 403
        opened_shift = client.post("/api/cash/sessions", headers=cashier_headers, json={"openingAmount":50000,"openedBy":"No confiar en este dato"})
        assert opened_shift.status_code == 201, opened_shift.text
        shift = client.get("/api/cash/sessions/current", headers=cashier_headers)
        assert shift.status_code == 200 and shift.json()["openedBy"] == "Cajero Prueba", shift.text
        cash_sale_payload = {"idempotencyKey":"cashier-own-sale-001","items":[{"productId":empanada["id"],"quantity":1}],"paymentMethod":"cash","cashSessionId":shift.json()["id"],"taxRate":0}
        cashier_sale = client.post("/api/sales", headers=cashier_headers, json=cash_sale_payload)
        assert cashier_sale.status_code == 201, cashier_sale.text
        assert cashier_sale.json()["createdBy"] == cashier_login.json()["user"]["id"]
        cashier_dashboard_after_sale = client.get("/api/dashboard", headers=cashier_headers)
        assert cashier_dashboard_after_sale.status_code == 200, cashier_dashboard_after_sale.text
        assert cashier_dashboard_after_sale.json()["revenueLast7Days"] == cashier_sale.json()["totalPrice"], cashier_dashboard_after_sale.json()
        owner_dashboard_after_cashier_sale = client.get("/api/dashboard", headers=auth)
        assert owner_dashboard_after_cashier_sale.json()["revenueLast7Days"] > cashier_sale.json()["totalPrice"]
        assert client.get(f"/api/sales/{cashier_sale.json()['id']}", headers=auth).status_code == 200
        order = client.post("/api/orders", headers=cashier_headers, json={"channel":"takeaway","items":[{"productId":empanada["id"],"quantity":1}]})
        assert order.status_code == 201, order.text
        assert client.post("/api/auth/logout", headers=cashier_headers).status_code == 200
        assert client.get("/api/products", headers=cashier_headers).status_code == 401

        # Hotel and service records are stored in tenant-owned tables and cannot be read across tenants.
        hotel_register = client.post("/api/auth/register", json={"name":"Propietaria Hotel", "email":"hotel-owner@test.local", "password":"HotelSeguro123!"})
        assert hotel_register.status_code == 201, hotel_register.text
        hotel_headers = {"Authorization": f"Bearer {hotel_register.json()['access_token']}"}
        hotel_config = {"type":"hotel", "name":"Hotel Aurora", "currency":"COP", "taxRate":0, "features":{"inventory":True,"pos":True,"reservations":True,"tables":False,"rooms":True,"warehouse":False,"services":False,"delivery":False}}
        assert client.put("/api/business/config", headers=hotel_headers, json=hotel_config).status_code == 200
        room = client.post("/api/hotel/rooms", headers=hotel_headers, json={"roomNumber":"101","roomType":"simple","floor":1,"capacity":1,"pricePerNight":85000,"status":"available","amenities":["WiFi"]})
        assert room.status_code == 201, room.text
        reservation = client.post("/api/hotel/reservations", headers=hotel_headers, json={"roomId":room.json()["id"],"guestName":"Huésped de prueba","checkIn":"2027-01-10","checkOut":"2027-01-12","advance":50000})
        assert reservation.status_code == 201, reservation.text
        assert reservation.json()["nights"] == 2 and reservation.json()["totalCharges"] == 170000
        following_reservation = client.post("/api/hotel/reservations", headers=hotel_headers, json={"roomId":room.json()["id"],"guestName":"Siguiente huésped","checkIn":"2027-01-12","checkOut":"2027-01-13","advance":0})
        assert following_reservation.status_code == 201, following_reservation.text
        assert client.get("/api/hotel/reservations", headers=auth).status_code == 403
        assert client.get("/api/hotel/rooms", headers=hotel_headers).json()[0]["number"] == "101"
        assert client.patch(f"/api/hotel/reservations/{reservation.json()['id']}/status", headers=hotel_headers, json={"status":"checkin"}).status_code == 200
        checked_out = client.patch(f"/api/hotel/reservations/{reservation.json()['id']}/status", headers=hotel_headers, json={"status":"checkout"})
        assert checked_out.status_code == 200, checked_out.text
        assert client.get("/api/hotel/rooms", headers=hotel_headers).json()[0]["status"] == "reserved", "Checkout must preserve a following reservation for the same room."

        # Expired transitions delete only hotel-specific records for the switching tenant.
        hotel_to_services = {"type":"services","name":"Hotel reconvertido temporalmente","currency":"COP","taxRate":0,"features":{"inventory":False,"pos":True,"reservations":True,"tables":False,"rooms":False,"warehouse":False,"services":True,"delivery":False}}
        assert client.put("/api/business/config", headers=hotel_headers, json=hotel_to_services).status_code == 200
        with connection() as conn:
            pending_hotel = conn.execute("SELECT id FROM business_type_transitions WHERE business_id=? AND old_type='hotel' AND new_type='services' AND status='pending' ORDER BY created_at DESC LIMIT 1", (hotel_register.json()["user"]["businessId"],)).fetchone()
            assert pending_hotel, "The type transition should be persisted."
            expired_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
            conn.execute("UPDATE business_type_transitions SET expires_at=? WHERE id=?", (expired_at, pending_hotel["id"]))
        assert client.get("/api/business/type-transitions", headers=hotel_headers).status_code == 200
        with connection() as conn:
            assert conn.execute("SELECT count(*) FROM hotel_rooms WHERE business_id=?", (hotel_register.json()["user"]["businessId"],)).fetchone()[0] == 0
            assert conn.execute("SELECT count(*) FROM hotel_reservations WHERE business_id=?", (hotel_register.json()["user"]["businessId"],)).fetchone()[0] == 0
            assert conn.execute("SELECT status FROM business_type_transitions WHERE id=?", (pending_hotel["id"],)).fetchone()[0] == "expired"

        service_register = client.post("/api/auth/register", json={"name":"Propietario Servicios","email":"service-owner@test.local","password":"ServiciosSeguro123!"})
        assert service_register.status_code == 201, service_register.text
        service_headers = {"Authorization": f"Bearer {service_register.json()['access_token']}"}
        service_config = {"type":"services","name":"Servicios Integrales Norte","currency":"COP","taxRate":0,"features":{"inventory":False,"pos":True,"reservations":True,"tables":False,"rooms":False,"warehouse":False,"services":True,"delivery":False}}
        assert client.put("/api/business/config", headers=service_headers, json=service_config).status_code == 200
        service = client.post("/api/services/catalog", headers=service_headers, json={"name":"Consulta inicial","durationMinutes":30,"price":45000,"category":"Servicios principales","color":"#315F68"})
        assert service.status_code == 201, service.text
        professional = client.post("/api/services/professionals", headers=service_headers, json={"name":"Profesional Demo","specialty":"Consultoría","color":"#315F68"})
        assert professional.status_code == 201, professional.text
        appointment = client.post("/api/services/appointments", headers=service_headers, json={"serviceId":service.json()["id"],"professionalId":professional.json()["id"],"clientName":"Cliente de prueba","appointmentDate":"2027-01-10","startTime":"10:00"})
        assert appointment.status_code == 201, appointment.text
        assert appointment.json()["horaFin"] == "10:30"
        edited_appointment = client.put(f"/api/services/appointments/{appointment.json()['id']}", headers=service_headers, json={"serviceId":service.json()["id"],"professionalId":professional.json()["id"],"clientName":"Cliente actualizado","appointmentDate":"2027-01-10","startTime":"11:00","clientPhone":"3001234567"})
        assert edited_appointment.status_code == 200 and edited_appointment.json()["horaInicio"] == "11:00" and edited_appointment.json()["clienteNombre"] == "Cliente actualizado", edited_appointment.text
        removable_appointment = client.post("/api/services/appointments", headers=service_headers, json={"serviceId":service.json()["id"],"professionalId":professional.json()["id"],"clientName":"Cliente para borrar","appointmentDate":"2027-01-10","startTime":"12:00"})
        assert removable_appointment.status_code == 201, removable_appointment.text
        assert client.delete(f"/api/services/appointments/{removable_appointment.json()['id']}", headers=service_headers).status_code == 204
        assert all(row["id"] != removable_appointment.json()["id"] for row in client.get("/api/services/appointments", headers=service_headers).json())
        assert client.get("/api/services/appointments", headers=auth).status_code == 403
        assert client.get("/api/services/appointments", headers=hotel_headers).json() == []  # switched tenant has no service appointments; cross-tenant data must not leak
        assert client.get("/api/services/appointments", headers=service_headers).json()[0]["clienteNombre"] == "Cliente actualizado"

        # Service-specific data is removed after expiry, without deleting common products or users.
        retail_from_services = {"type":"retail","name":"Servicios reconvertidos temporalmente","currency":"COP","taxRate":0,"features":{"inventory":True,"pos":True,"reservations":False,"tables":False,"rooms":False,"warehouse":False,"services":False,"delivery":False}}
        assert client.put("/api/business/config", headers=service_headers, json=retail_from_services).status_code == 200
        with connection() as conn:
            service_biz_id = service_register.json()["user"]["businessId"]
            pending_services = conn.execute("SELECT id FROM business_type_transitions WHERE business_id=? AND old_type='services' AND new_type='retail' AND status='pending' ORDER BY created_at DESC LIMIT 1", (service_biz_id,)).fetchone()
            assert pending_services
            expired_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
            conn.execute("UPDATE business_type_transitions SET expires_at=? WHERE id=?", (expired_at, pending_services["id"]))
        assert client.get("/api/business/type-transitions", headers=service_headers).status_code == 200
        with connection() as conn:
            assert conn.execute("SELECT count(*) FROM service_appointments WHERE business_id=?", (service_biz_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT count(*) FROM service_catalog WHERE business_id=?", (service_biz_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT count(*) FROM service_professionals WHERE business_id=?", (service_biz_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT count(*) FROM auth_users WHERE business_id=?", (service_biz_id,)).fetchone()[0] >= 1

    print("OK: categorías específicas y personalizadas, validación de unidades enteras, transición y limpieza automática de 15 días, autenticación, roles, aislamiento tenant, hotel y citas persistidas por negocio, temas, suspensión/chat, comida sin recetas, ventas atómicas, costos históricos, idempotencia, paginación, reversos, caja y auditoría.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
