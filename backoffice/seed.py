"""
Initialize the database with starter data.

Creates: the tables, 1 admin, 2 branches, and sample stock.

SECURITY: the admin password is NEVER written in plain text in this file.
It is read from the ADMIN_PASSWORD environment variable, and only its
Argon2id hash is stored. Run for example:

    ADMIN_PASSWORD="aStrongPassword" python seed.py

The sample stock uses real sku values present in the provided Product API.
"""

import os

from database import engine, SessionLocal, Base
from models import Branch, User, Stock
from security import hash_password, validate_password_strength

# Every sku in the Product API catalog (data/products.json), all 40 of
# them, so the Backoffice has stock data for the entire supplier catalog
# rather than a handful of examples. Quantity is a simple heuristic (cheap,
# high-turnover consumables get more units than expensive equipment) with a
# small Lyon/Paris offset so the two branches aren't identical; the one
# discontinued item (HB-OLD-1301) gets a token leftover quantity instead of
# being restocked. (branch quantities: Lyon, Paris)
SAMPLE_STOCK = [
    ("HB-LAP-1001", 3, 2),    # Holberton Student Laptop 14
    ("HB-LAP-1002", 2, 3),    # Holberton Student Laptop 16
    ("HB-MON-2101", 3, 2),    # 27 inch Lab Monitor
    ("HB-MON-2102", 2, 3),    # 24 inch Compact Monitor
    ("HB-DCK-3001", 3, 2),    # USB-C Teaching Dock
    ("HB-KBD-4101", 2, 3),    # Mechanical Keyboard EN
    ("HB-KBD-4102", 5, 4),    # Compact Keyboard ES
    ("HB-MSE-4201", 9, 10),   # Wireless Mouse
    ("HB-CAM-5101", 4, 3),    # HD Webcam
    ("HB-MIC-5201", 3, 4),    # USB Classroom Microphone
    ("HB-HDS-5301", 6, 5),    # Noise-Isolating Headset
    ("HB-RTR-6101", 2, 3),    # Lab Router AC1200
    ("HB-SWT-6201", 3, 2),    # 8-Port Managed Switch
    ("HB-CBL-6301", 29, 30),  # Ethernet Cable 2m
    ("HB-SSD-7101", 3, 2),    # External SSD 1TB
    ("HB-SSD-7102", 2, 3),    # External SSD 2TB
    ("HB-USB-7201", 28, 27),  # USB Drive 64GB
    ("HB-USB-7202", 16, 17),  # USB Drive 128GB
    ("HB-PWR-8101", 7, 6),    # Laptop Charger 65W
    ("HB-PWR-8102", 3, 4),    # USB-C Charger 100W
    ("HB-PWR-8201", 9, 8),    # Surge Protector 6-Outlet
    ("HB-CHR-9101", 2, 3),    # Ergonomic Lab Chair
    ("HB-DSK-9201", 3, 2),    # Compact Student Desk
    ("HB-WHT-9301", 2, 3),    # Mobile Whiteboard
    ("HB-BAG-1011", 13, 12),  # Laptop Sleeve 14
    ("HB-BAG-1012", 4, 5),    # Laptop Backpack
    ("HB-DEV-1111", 3, 2),    # Single Board Computer Kit
    ("HB-DEV-1112", 5, 6),    # Sensor Starter Kit
    ("HB-DEV-1113", 20, 19),  # Breadboard Pack
    ("HB-ACC-1211", 29, 30),  # HDMI Cable 1.5m
    ("HB-ACC-1212", 25, 24),  # USB-C Cable 1m
    ("HB-OLD-1301", 1, 1),    # Legacy VGA Adapter (discontinued, leftover only)
    ("HB-SEC-1401", 11, 10),  # RFID Access Card Pack
    ("HB-SEC-1402", 5, 6),    # USB Security Key
    ("HB-PRN-1501", 3, 2),    # Label Printer
    ("HB-LBL-1502", 20, 21),  # Inventory Label Roll
    ("HB-SCN-1601", 4, 3),    # Barcode Scanner USB
    ("HB-TAB-1701", 2, 3),    # Inventory Tablet 10
    ("HB-TAB-1702", 10, 9),   # Protective Tablet Case
    ("HB-LGT-1801", 7, 8),    # Desk Lamp LED
]


def init_data() -> None:
    # 1. Create every table defined in models.py.
    Base.metadata.create_all(engine)

    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_password:
        raise SystemExit(
            "Set the ADMIN_PASSWORD variable before running the seed.\n"
            'Example: ADMIN_PASSWORD="strongPassword" python seed.py'
        )
    try:
        validate_password_strength(admin_password)
    except ValueError as e:
        raise SystemExit(f"ADMIN_PASSWORD is too weak: {e}")

    session = SessionLocal()
    try:
        # Avoid recreating data if the seed already ran.
        if session.query(User).count() > 0:
            print("Database already contains data. Nothing to do.")
            return

        # 2. Two branches.
        lyon = Branch(name="Lyon")
        paris = Branch(name="Paris")
        session.add_all([lyon, paris])
        session.flush()  # assign ids without finalizing the transaction

        # 3. The admin user (no branch, admin role).
        admin = User(
            username="admin",
            password_hash=hash_password(admin_password),
            role="admin",
            branch_id=None,
        )
        session.add(admin)

        # 4. Sample stock spread across the two branches, for every product
        # in the catalog.
        for sku, lyon_qty, paris_qty in SAMPLE_STOCK:
            session.add(
                Stock(branch_id=lyon.id, product_sku=sku, quantity=lyon_qty)
            )
            session.add(
                Stock(branch_id=paris.id, product_sku=sku, quantity=paris_qty)
            )

        session.commit()
        print(
            "Database initialized: 2 branches, 1 admin, "
            "sample stock created."
        )
    finally:
        session.close()


if __name__ == "__main__":
    init_data()