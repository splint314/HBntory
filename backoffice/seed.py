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

# Real sku values taken from the Product API catalog (data/products.json).
SAMPLE_STOCK = [
    ("HB-LAP-1001", 10),   # Holberton Student Laptop 14
    ("HB-MON-2101", 5),    # 27 inch Lab Monitor
    ("HB-KBD-4102", 25),   # Compact Keyboard ES
    ("HB-SSD-7101", 15),   # External SSD 1TB
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

        # 4. Sample stock spread across the two branches.
        for sku, qty in SAMPLE_STOCK:
            session.add(
                Stock(branch_id=lyon.id, product_sku=sku, quantity=qty)
            )
        session.add(
            Stock(branch_id=paris.id, product_sku="HB-LAP-1001", quantity=7)
        )
        session.add(
            Stock(branch_id=paris.id, product_sku="HB-MON-2101", quantity=12)
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