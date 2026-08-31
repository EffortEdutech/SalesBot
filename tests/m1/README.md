# M1 Automated Test Suite

Canonical scenario:

```text
Ahmad
Ipoh
Office
3 × 2HP AC units
Supply + installation
```

Expected provider total from the synthetic fixture:

```text
3 × RM2,150 product = RM6,450
3 × RM450 service   = RM1,350
Grand total         = RM7,800
```

The RM values are synthetic test data only.

The suite also covers:

- duplicate request replay
- provider create timeout after upstream commit
- restart/reconciliation
- missing service price
- expired price book
- ambiguous 2HP product search
- UOM mismatch
