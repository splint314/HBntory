"""
Manual sanity check for the stock validation rules (Task 1, exercise 4).

Not an automated test suite: just a quick script to eyeball the expected
behavior. Run `python seed.py` first so the Lyon branch exists.
"""

from database import SessionLocal
from models import Branch
from stock_service import add_stock, remove_stock

s = SessionLocal()
lyon = s.query(Branch).filter_by(name="Lyon").first()
if lyon is None:
    raise SystemExit("Run seed.py first: the Lyon branch does not exist.")

# check_product_api=False: this script runs without the Product API
# Docker container, which is not needed to test the local validation rules.
add_stock(s, lyon.id, "HB-LAP-1001", 5, check_product_api=False)
print("Added 5 units: OK")

# Rule: stock quantity can never go negative.
try:
    remove_stock(s, lyon.id, "HB-LAP-1001", 99999)
except ValueError as e:
    print("Excessive removal rejected:", e)

# Rule: quantity must be a strictly positive integer.
for bad_quantity in [-3, 0, 2.5]:
    try:
        add_stock(
            s, lyon.id, "HB-LAP-1001", bad_quantity, check_product_api=False
        )
    except ValueError as e:
        print(f"Quantity {bad_quantity} rejected:", e)

# Rule: the branch must exist.
try:
    add_stock(s, 9999, "HB-LAP-1001", 5, check_product_api=False)
except ValueError as e:
    print("Non-existent branch rejected:", e)

s.close()
